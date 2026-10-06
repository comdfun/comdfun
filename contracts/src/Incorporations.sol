// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {LaunchToken} from "./launch/LaunchToken.sol";

interface IRewardDripperLike {
    function notifyReward(uint256 amount) external;
}

interface IComdRouterSwaps {
    function swapExactETHForComd(uint256 minOut, address to, uint256 deadline) external payable returns (uint256);
    function swapExactComdForETH(uint256 amountIn, uint256 minOut, address to, uint256 deadline)
        external
        returns (uint256);
}

/// @title Incorporations — company coins on a COMD bonding curve (Community Coins equivalent) — Company.md
/// @notice UNAUDITED — experimental. Do not use with funds you cannot afford to lose.
/// @notice Anyone creates a coin for gas: 1,000,000,000 supply, all of it in a virtual constant-product
///         curve priced in COMD: x = virtualComd + comdReserve, y = coinReserve, x·y constant.
///         Every coin's real COMD sits in this one contract — the shared COMD backing reserve (`totalBacking`),
///         with per-coin accounting so one coin's sellers can never take another's backing.
/// @notice Fees per trade: 1% of the COMD side to sCOMD stakers (RewardDripper.notifyReward), 0.5% of the COMD side
///         burned, and 0.5% to the launcher — in ETH for ETH trades (of the ETH side), in COMD for COMD trades.
///         Launcher ETH accrues here and is pulled with `claimLauncherEth`.
/// @notice ETH trades route through ComdRouter on the official pool: every ETH buy is a COMD buy and pays the
///         pool's 5% ETH tax on that leg. The intermediate ETH↔COMD leg has no own minimum; the trader's
///         `minOut` on the final asset bounds the whole route.
/// @notice Graduation (migrating a coin to a v4 COMD pool at a threshold) is NOT implemented (phase 2).
/// @notice Owner powers (renounceable): set `virtualComd` for coins created afterwards, within bounds.
contract Incorporations is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant COIN_SUPPLY = 1_000_000_000e18;
    uint256 public constant BPS = 10_000;
    uint256 public constant STAKERS_BPS = 100;
    uint256 public constant LAUNCHER_BPS = 50;
    uint256 public constant BURN_BPS = 50;
    uint256 public constant MIN_VIRTUAL = 1_000e18;
    uint256 public constant MAX_VIRTUAL = 10_000_000e18;

    struct Coin {
        address creator;
        uint64 createdAt;
        uint256 virtualComd;
        uint256 comdReserve;
        uint256 coinReserve;
        string metadataURI;
    }

    ERC20Burnable public immutable comd;
    IComdRouterSwaps public immutable router;
    IRewardDripperLike public immutable dripper;

    uint256 public virtualComd = 100_000e18;
    address[] public coins;
    mapping(address => Coin) internal _coins;
    mapping(address => uint256) public launcherEthOwed;
    uint256 public totalBacking;
    uint256 public totalBurned;
    uint256 public totalToStakers;

    event CoinCreated(address indexed coin, address indexed creator, string name, string symbol, string metadataURI);
    event Trade(
        address indexed coin,
        address indexed trader,
        bool isBuy,
        uint256 comdAmount,
        uint256 coinAmount,
        uint256 ethAmount
    );
    event Fees(address indexed coin, uint256 toStakers, uint256 burned, uint256 launcherComd, uint256 launcherEth);
    event LauncherEthClaimed(address indexed launcher, uint256 amount);
    event VirtualComdSet(uint256 virtualComd);

    error UnknownCoin();
    error ZeroAmount();
    error Slippage(uint256 out, uint256 minOut);
    error OutOfBounds();
    error TransferFailed();
    error EmptyName();

    constructor(ERC20Burnable comd_, IComdRouterSwaps router_, IRewardDripperLike dripper_, address owner_)
        Ownable(owner_)
    {
        comd = comd_;
        router = router_;
        dripper = dripper_;
        IERC20(address(comd_)).forceApprove(address(router_), type(uint256).max);
        IERC20(address(comd_)).forceApprove(address(dripper_), type(uint256).max);
    }

    receive() external payable {}

    // =====================================================================================
    //                                        create
    // =====================================================================================

    function create(string calldata name, string calldata symbol, string calldata metadataURI)
        external
        nonReentrant
        returns (address coin)
    {
        if (bytes(name).length == 0 || bytes(symbol).length == 0) revert EmptyName();
        coin = address(new LaunchToken(name, symbol, COIN_SUPPLY, address(this)));
        _coins[coin] = Coin({
            creator: msg.sender,
            createdAt: uint64(block.timestamp),
            virtualComd: virtualComd,
            comdReserve: 0,
            coinReserve: COIN_SUPPLY,
            metadataURI: metadataURI
        });
        coins.push(coin);
        emit CoinCreated(coin, msg.sender, name, symbol, metadataURI);
    }

    // =====================================================================================
    //                                    COMD trades
    // =====================================================================================

    function buyWithComd(address coin, uint256 comdIn, uint256 minOut) external nonReentrant returns (uint256 out) {
        Coin storage c = _coin(coin);
        if (comdIn == 0) revert ZeroAmount();
        IERC20(address(comd)).safeTransferFrom(msg.sender, address(this), comdIn);
        uint256 net = comdIn - _takeFees(coin, c.creator, comdIn, true);
        out = _buy(c, net);
        if (out < minOut) revert Slippage(out, minOut);
        IERC20(coin).safeTransfer(msg.sender, out);
        emit Trade(coin, msg.sender, true, comdIn, out, 0);
    }

    function sellForComd(address coin, uint256 amountIn, uint256 minComdOut)
        external
        nonReentrant
        returns (uint256 out)
    {
        Coin storage c = _coin(coin);
        if (amountIn == 0) revert ZeroAmount();
        IERC20(coin).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 gross = _sell(c, amountIn);
        out = gross - _takeFees(coin, c.creator, gross, true);
        if (out < minComdOut) revert Slippage(out, minComdOut);
        IERC20(address(comd)).safeTransfer(msg.sender, out);
        emit Trade(coin, msg.sender, false, out, amountIn, 0);
    }

    // =====================================================================================
    //                                      ETH trades
    // =====================================================================================

    function buyWithETH(address coin, uint256 minOut) external payable nonReentrant returns (uint256 out) {
        Coin storage c = _coin(coin);
        if (msg.value == 0) revert ZeroAmount();
        uint256 launcherEth = (msg.value * LAUNCHER_BPS) / BPS;
        launcherEthOwed[c.creator] += launcherEth;
        uint256 sent = msg.value - launcherEth;
        uint256 bal0 = address(this).balance;
        uint256 comdIn = router.swapExactETHForComd{value: sent}(0, address(this), block.timestamp);
        // ETH the router refunded (partial fill when the pool runs out of liquidity) goes back to the trader
        // instead of being stranded here (security review L-03)
        uint256 unused = address(this).balance + sent - bal0;
        uint256 net = comdIn - _takeFees(coin, c.creator, comdIn, false);
        out = _buy(c, net);
        if (out < minOut) revert Slippage(out, minOut);
        IERC20(coin).safeTransfer(msg.sender, out);
        if (unused > 0) {
            (bool ok,) = msg.sender.call{value: unused}("");
            if (!ok) revert TransferFailed();
        }
        emit Fees(coin, 0, 0, 0, launcherEth);
        emit Trade(coin, msg.sender, true, comdIn, out, msg.value - unused);
    }

    function sellForETH(address coin, uint256 amountIn, uint256 minEthOut)
        external
        nonReentrant
        returns (uint256 ethOut)
    {
        Coin storage c = _coin(coin);
        if (amountIn == 0) revert ZeroAmount();
        IERC20(coin).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 gross = _sell(c, amountIn);
        uint256 net = gross - _takeFees(coin, c.creator, gross, false);
        uint256 ethGross = router.swapExactComdForETH(net, 0, address(this), block.timestamp);
        uint256 launcherEth = (ethGross * LAUNCHER_BPS) / BPS;
        launcherEthOwed[c.creator] += launcherEth;
        ethOut = ethGross - launcherEth;
        if (ethOut < minEthOut) revert Slippage(ethOut, minEthOut);
        (bool ok,) = msg.sender.call{value: ethOut}("");
        if (!ok) revert TransferFailed();
        emit Fees(coin, 0, 0, 0, launcherEth);
        emit Trade(coin, msg.sender, false, net, amountIn, ethOut);
    }

    function claimLauncherEth() external nonReentrant returns (uint256 amount) {
        amount = launcherEthOwed[msg.sender];
        launcherEthOwed[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit LauncherEthClaimed(msg.sender, amount);
    }

    // =====================================================================================
    //                                        quotes
    // =====================================================================================

    /// @notice Coins out for a COMD buy of `comdIn` (after the 2% fees).
    function quoteBuy(address coin, uint256 comdIn) external view returns (uint256) {
        Coin storage c = _coin(coin);
        uint256 net = comdIn - _feeTotal(comdIn, true);
        return _buyOut(c, net);
    }

    /// @notice COMD out (after the 2% fees) for selling `amountIn` coins for COMD.
    function quoteSell(address coin, uint256 amountIn) external view returns (uint256) {
        Coin storage c = _coin(coin);
        uint256 gross = _sellOut(c, amountIn);
        return gross - _feeTotal(gross, true);
    }

    /// @notice Spot price: COMD wei per 1e18 coin wei.
    function spotPrice(address coin) external view returns (uint256) {
        Coin storage c = _coin(coin);
        return ((c.virtualComd + c.comdReserve) * 1e18) / c.coinReserve;
    }

    function coinCount() external view returns (uint256) {
        return coins.length;
    }

    function coinInfo(address coin) external view returns (Coin memory) {
        return _coins[coin];
    }

    // =====================================================================================
    //                                        owner
    // =====================================================================================

    function setVirtualComd(uint256 v) external onlyOwner {
        if (v < MIN_VIRTUAL || v > MAX_VIRTUAL) revert OutOfBounds();
        virtualComd = v;
        emit VirtualComdSet(v);
    }

    // =====================================================================================
    //                                       internals
    // =====================================================================================

    function _coin(address coin) internal view returns (Coin storage c) {
        c = _coins[coin];
        if (c.creator == address(0)) revert UnknownCoin();
    }

    function _buyOut(Coin storage c, uint256 net) internal view returns (uint256) {
        uint256 x = c.virtualComd + c.comdReserve;
        return (c.coinReserve * net) / (x + net);
    }

    function _sellOut(Coin storage c, uint256 amountIn) internal view returns (uint256 out) {
        uint256 x = c.virtualComd + c.comdReserve;
        out = (x * amountIn) / (c.coinReserve + amountIn);
        if (out > c.comdReserve) out = c.comdReserve;
    }

    function _buy(Coin storage c, uint256 net) internal returns (uint256 out) {
        out = _buyOut(c, net);
        if (out == 0) revert ZeroAmount();
        c.comdReserve += net;
        c.coinReserve -= out;
        totalBacking += net;
    }

    function _sell(Coin storage c, uint256 amountIn) internal returns (uint256 out) {
        out = _sellOut(c, amountIn);
        if (out == 0) revert ZeroAmount();
        c.comdReserve -= out;
        c.coinReserve += amountIn;
        totalBacking -= out;
    }

    function _feeTotal(uint256 amount, bool comdTrade) internal pure returns (uint256) {
        uint256 f = (amount * STAKERS_BPS) / BPS + (amount * BURN_BPS) / BPS;
        if (comdTrade) f += (amount * LAUNCHER_BPS) / BPS;
        return f;
    }

    /// @dev Takes the COMD-side fees out of `amount` held by this contract; returns the total taken.
    function _takeFees(address coin, address creator, uint256 amount, bool comdTrade)
        internal
        returns (uint256 total)
    {
        uint256 toStakers = (amount * STAKERS_BPS) / BPS;
        uint256 burned = (amount * BURN_BPS) / BPS;
        uint256 toLauncher = comdTrade ? (amount * LAUNCHER_BPS) / BPS : 0;
        if (toStakers > 0) dripper.notifyReward(toStakers);
        if (burned > 0) comd.burn(burned);
        if (toLauncher > 0) IERC20(address(comd)).safeTransfer(creator, toLauncher);
        totalToStakers += toStakers;
        totalBurned += burned;
        total = toStakers + burned + toLauncher;
        emit Fees(coin, toStakers, burned, toLauncher, 0);
    }
}
