// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "v4-core/src/libraries/FixedPoint96.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {LaunchToken} from "./launch/LaunchToken.sol";
import {LaunchGuardHook} from "./launch/LaunchGuardHook.sol";
import {IBuybackSwapper} from "./interfaces/IBuybackSwapper.sol";
import {LiquidityAmountsLib} from "./libraries/LiquidityAmountsLib.sol";
import {TickAlign} from "./libraries/TickAlign.sol";

/// @title Incorporations — company coins on a $COMD bonding curve (Community Coins equivalent) — Company.md
/// @notice UNAUDITED — experimental. Do not use with funds you cannot afford to lose.
/// @notice Anyone creates a coin for gas: 1,000,000,000 supply, all of it in a virtual constant-product
///         curve priced in COMD: x = virtualComd + comdReserve, y = coinReserve, x·y constant.
///         Every coin's real COMD sits in this one contract — the shared COMD backing reserve (`totalBacking`),
///         with per-coin accounting so one coin's sellers can never take another's backing.
/// @notice COMD is the external Pons token (may have no `burn()`): burns are transfers to the dead address.
///         Fees per trade: 1% of the COMD side to Counsel rewards (RewardDistributor, COMD), 0.5% of the COMD side
///         burned, and 0.5% to the launcher — in ETH for ETH trades (of the ETH side), in COMD for COMD trades.
///         Launcher ETH accrues here (`launcherEthOwed`, total in `totalLauncherEthOwed`) and is pulled with
///         `claimLauncherEth`.
/// @notice ETH trades route ETH↔COMD through the pluggable `IBuybackSwapper` (owner `setSwapper`, configured after
///         the Pons graduation); until then `buyWithETH`/`sellForETH` revert `SwapperNotSet()` and COMD trades work.
///         The intermediate leg has no own minimum; the trader's `minOut` on the final asset bounds the whole route.
/// @notice **Graduation.** The buy that lifts a coin's real COMD reserve to `graduationThreshold` (owner-set, default
///         400,000 COMD) moves the coin to Uniswap v4 in the same transaction: a coin/$COMD pool is initialized at the
///         curve's spot price (through `graduationHook`, a LaunchGuardHook that lets only this contract initialize, so
///         nobody can front-run the pool with a bad price), ALL of the coin's COMD backing plus the matching amount
///         of its unsold supply go in as full-range liquidity owned by this contract forever (no function can remove
///         it), and the rest of the unsold supply is burned. The curve then refuses trades for that coin
///         (`CoinGraduated()`); it trades on Uniswap, paired with $COMD, with `graduationFee` (default 1%).
///         `graduate(coin)` is permissionless for a coin that is already above the threshold (e.g. created before
///         the hook was set). Pool fees are collected by anyone with `collectPoolFees(coin)`: the $COMD side goes to
///         Counsel rewards, the coin side is burned.
/// @notice Owner powers (Ownable2Step, renounceable): set `virtualComd` for coins created afterwards, within bounds;
///         set the swapper.
///         **Safety nets (V7).** `pause()` stops `create` and all four trade functions (launcher ETH claims stay
///         open). Recovery policy, from least to most invasive:
///         1. `rescueERC20(token, to, amount)` — only SURPLUS: for COMD what exceeds `totalBacking`, for a company
///            coin what exceeds its `coinReserve`, any other token fully. `rescueETH(to, amount)` — only what exceeds
///            `totalLauncherEthOwed`. Both work any time and can never touch what traders are owed.
///         2. `scheduleEmergencyWithdraw()` (paused) → wait `EMERGENCY_DELAY` (48 h, public countdown in
///            `emergencyWithdrawAt`, cancellable) → `emergencyWithdraw(to)` moves ALL COMD and ETH out. This is the
///            true-emergency path (curve bug): trading is already frozen by the pause, the delay gives traders and
///            launchers notice, and `unpause()` refuses until the contract is solvent again
///            (COMD balance ≥ `totalBacking`, ETH balance ≥ `totalLauncherEthOwed`), so trading cannot resume on an
///            emptied curve without the owner first restoring the backing.
contract Incorporations is Ownable2Step, Pausable, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 public constant COIN_SUPPLY = 1_000_000_000e18;
    uint256 public constant BPS = 10_000;
    uint256 public constant REWARDS_BPS = 100;
    uint256 public constant LAUNCHER_BPS = 50;
    uint256 public constant BURN_BPS = 50;
    uint256 public constant MIN_VIRTUAL = 1_000e18;
    uint256 public constant MAX_VIRTUAL = 10_000_000e18;
    uint256 public constant EMERGENCY_DELAY = 48 hours;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant MIN_GRADUATION = 10_000e18;
    uint256 public constant MAX_GRADUATION = 1_000_000_000e18;
    uint8 internal constant OP_SEED = 1;
    uint8 internal constant OP_COLLECT = 2;

    struct Coin {
        address creator;
        uint64 createdAt;
        uint256 virtualComd;
        uint256 comdReserve;
        uint256 coinReserve;
        string metadataURI;
    }

    /// @notice A coin's Uniswap v4 pool after graduation (zeroed while it is still on the curve).
    struct Graduation {
        bool done;
        uint64 at;
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 comdIn;
        uint256 coinIn;
        uint256 coinBurned;
        uint256 feesComd;
        uint256 feesCoin;
    }

    IERC20 public immutable comd;
    address public immutable rewardDistributor;
    IPoolManager public immutable poolManager;
    /// @notice May set `graduationHook` once (deploy-time wiring; the hook needs this contract's address first).
    address public immutable installer;
    IBuybackSwapper public swapper;
    IHooks public graduationHook;
    uint256 public graduationThreshold = 400_000e18;
    uint24 public graduationFee = 10_000;
    int24 public graduationTickSpacing = 200;
    uint256 public graduatedCount;
    mapping(address => Graduation) internal _grads;

    uint256 public virtualComd = 100_000e18;
    address[] public coins;
    mapping(address => Coin) internal _coins;
    mapping(address => uint256) public launcherEthOwed;
    uint256 public totalLauncherEthOwed;
    uint256 public totalBacking;
    uint256 public totalBurned;
    uint256 public totalToRewards;
    /// @notice 0 = no emergency withdraw scheduled; otherwise the timestamp from which `emergencyWithdraw` works.
    uint256 public emergencyWithdrawAt;

    event CoinCreated(address indexed coin, address indexed creator, string name, string symbol, string metadataURI);
    event Trade(
        address indexed coin,
        address indexed trader,
        bool isBuy,
        uint256 comdAmount,
        uint256 coinAmount,
        uint256 ethAmount
    );
    event Fees(address indexed coin, uint256 toRewards, uint256 burned, uint256 launcherComd, uint256 launcherEth);
    event LauncherEthClaimed(address indexed launcher, uint256 amount);
    event VirtualComdSet(uint256 virtualComd);
    event SwapperSet(address swapper);
    event Rescued(address indexed token, address indexed to, uint256 amount);
    event EmergencyWithdrawScheduled(uint256 at);
    event EmergencyWithdrawCancelled();
    event EmergencyWithdrawn(address indexed to, uint256 comdAmount, uint256 ethAmount);
    event GraduationHookSet(address hook);
    event GraduationThresholdSet(uint256 threshold);
    event GraduationFeeSet(uint24 fee, int24 tickSpacing);
    event Graduated(
        address indexed coin,
        bytes32 indexed poolId,
        uint160 sqrtPriceX96,
        uint256 comdIn,
        uint256 coinIn,
        uint256 coinBurned,
        uint128 liquidity
    );
    event PoolFeesCollected(address indexed coin, uint256 comdToRewards, uint256 coinBurned);

    error UnknownCoin();
    error ZeroAmount();
    error ZeroAddress();
    error Slippage(uint256 out, uint256 minOut);
    error OutOfBounds();
    error TransferFailed();
    error EmptyName();
    error SwapperNotSet();
    error ExceedsSurplus(uint256 surplus, uint256 requested);
    error NotScheduled();
    error TooEarly(uint256 at);
    error Insolvent(uint256 comdBalance, uint256 backing, uint256 ethBalance, uint256 ethOwed);
    error CoinGraduated();
    error NotGraduated();
    error NotEligible(uint256 reserve, uint256 threshold);
    error HookNotSet();
    error AlreadySet();
    error BadHook();
    error NotPoolManager();
    error NotInstaller();
    error BadFee();

    /// @param swapper_ may be address(0): ETH paths revert `SwapperNotSet()` until the owner sets one
    /// @param poolManager_ Uniswap v4 PoolManager the coins graduate into
    /// @param installer_ the deployer: may call `setGraduationHook` once (owner can always); no other power
    constructor(
        IERC20 comd_,
        address rewardDistributor_,
        IBuybackSwapper swapper_,
        IPoolManager poolManager_,
        address installer_,
        address owner_
    ) Ownable(owner_) {
        if (address(comd_) == address(0) || rewardDistributor_ == address(0) || address(poolManager_) == address(0)) {
            revert ZeroAddress();
        }
        comd = comd_;
        rewardDistributor = rewardDistributor_;
        poolManager = poolManager_;
        installer = installer_;
        _setSwapper(address(swapper_));
    }

    receive() external payable {}

    // =====================================================================================
    //                                        create
    // =====================================================================================

    function create(string calldata name, string calldata symbol, string calldata metadataURI)
        external
        nonReentrant
        whenNotPaused
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

    function buyWithComd(address coin, uint256 comdIn, uint256 minOut)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 out)
    {
        Coin storage c = _live(coin);
        if (comdIn == 0) revert ZeroAmount();
        comd.safeTransferFrom(msg.sender, address(this), comdIn);
        uint256 net = comdIn - _takeFees(coin, c.creator, comdIn, true);
        out = _buy(c, net);
        if (out < minOut) revert Slippage(out, minOut);
        IERC20(coin).safeTransfer(msg.sender, out);
        emit Trade(coin, msg.sender, true, comdIn, out, 0);
        _maybeGraduate(coin, c);
    }

    function sellForComd(address coin, uint256 amountIn, uint256 minComdOut)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 out)
    {
        Coin storage c = _live(coin);
        if (amountIn == 0) revert ZeroAmount();
        IERC20(coin).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 gross = _sell(c, amountIn);
        out = gross - _takeFees(coin, c.creator, gross, true);
        if (out < minComdOut) revert Slippage(out, minComdOut);
        comd.safeTransfer(msg.sender, out);
        emit Trade(coin, msg.sender, false, out, amountIn, 0);
    }

    // =====================================================================================
    //                                      ETH trades
    // =====================================================================================

    function buyWithETH(address coin, uint256 minOut)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 out)
    {
        Coin storage c = _live(coin);
        if (address(swapper) == address(0)) revert SwapperNotSet();
        if (msg.value == 0) revert ZeroAmount();
        uint256 launcherEth = (msg.value * LAUNCHER_BPS) / BPS;
        _oweLauncher(c.creator, launcherEth);
        uint256 sent = msg.value - launcherEth;
        uint256 bal0 = address(this).balance;
        uint256 comd0 = comd.balanceOf(address(this));
        swapper.swapExactETHForComd{value: sent}(0, address(this), block.timestamp);
        // COMD actually received (measured, not trusted from the venue)
        uint256 comdIn = comd.balanceOf(address(this)) - comd0;
        if (comdIn == 0) revert ZeroAmount();
        // ETH the venue refunded (partial fill) goes back to the trader instead of being stranded here (review L-03)
        uint256 unused = address(this).balance + sent - bal0;
        if (unused > sent) revert TransferFailed();
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
        _maybeGraduate(coin, c);
    }

    function sellForETH(address coin, uint256 amountIn, uint256 minEthOut)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 ethOut)
    {
        Coin storage c = _live(coin);
        if (address(swapper) == address(0)) revert SwapperNotSet();
        if (amountIn == 0) revert ZeroAmount();
        IERC20(coin).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 gross = _sell(c, amountIn);
        uint256 net = gross - _takeFees(coin, c.creator, gross, false);
        uint256 bal0 = address(this).balance;
        swapper.swapExactComdForETH(net, 0, address(this), block.timestamp);
        uint256 ethGross = address(this).balance - bal0;
        uint256 launcherEth = (ethGross * LAUNCHER_BPS) / BPS;
        _oweLauncher(c.creator, launcherEth);
        ethOut = ethGross - launcherEth;
        if (ethOut < minEthOut) revert Slippage(ethOut, minEthOut);
        (bool ok,) = msg.sender.call{value: ethOut}("");
        if (!ok) revert TransferFailed();
        emit Fees(coin, 0, 0, 0, launcherEth);
        emit Trade(coin, msg.sender, false, net, amountIn, ethOut);
    }

    /// @notice Launchers pull their ETH fees. Not paused: it is money already owed.
    function claimLauncherEth() external nonReentrant returns (uint256 amount) {
        amount = launcherEthOwed[msg.sender];
        launcherEthOwed[msg.sender] = 0;
        totalLauncherEthOwed -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit LauncherEthClaimed(msg.sender, amount);
    }

    // =====================================================================================
    //                                        quotes
    // =====================================================================================

    /// @notice Coins out for a COMD buy of `comdIn` (after the 2% fees).
    function quoteBuy(address coin, uint256 comdIn) external view returns (uint256) {
        Coin storage c = _live(coin);
        uint256 net = comdIn - _feeTotal(comdIn, true);
        return _buyOut(c, net);
    }

    /// @notice COMD out (after the 2% fees) for selling `amountIn` coins for COMD.
    function quoteSell(address coin, uint256 amountIn) external view returns (uint256) {
        Coin storage c = _live(coin);
        uint256 gross = _sellOut(c, amountIn);
        return gross - _feeTotal(gross, true);
    }

    /// @notice Spot price: COMD wei per 1e18 coin wei — from the curve, or from the Uniswap pool once graduated.
    function spotPrice(address coin) external view returns (uint256) {
        Coin storage c = _coin(coin);
        Graduation storage g = _grads[coin];
        if (!g.done) return ((c.virtualComd + c.comdReserve) * 1e18) / c.coinReserve;
        (uint160 sqrtP,,,) = poolManager.getSlot0(g.key.toId());
        uint256 priceX96 = FullMath.mulDiv(sqrtP, sqrtP, FixedPoint96.Q96); // currency1 per currency0, Q96
        return Currency.unwrap(g.key.currency0) == coin
            ? FullMath.mulDiv(priceX96, 1e18, FixedPoint96.Q96)
            : FullMath.mulDiv(FixedPoint96.Q96, 1e18, priceX96);
    }

    function graduationInfo(address coin) external view returns (Graduation memory) {
        return _grads[coin];
    }

    function isGraduated(address coin) external view returns (bool) {
        return _grads[coin].done;
    }

    /// @notice The buy amount (COMD, after fees) that would graduate `coin` now; 0 if already eligible or graduated.
    function comdToGraduate(address coin) external view returns (uint256) {
        Coin storage c = _coin(coin);
        if (_grads[coin].done || c.comdReserve >= graduationThreshold) return 0;
        return graduationThreshold - c.comdReserve;
    }

    /// @dev Lets the LaunchGuardHook's `rescueERC20` recognise the owner as the "factory admin" (role 0x00).
    function hasRole(bytes32 role, address account) external view returns (bool) {
        return role == bytes32(0) && account == owner();
    }

    function coinCount() external view returns (uint256) {
        return coins.length;
    }

    function coinInfo(address coin) external view returns (Coin memory) {
        return _coins[coin];
    }

    /// @notice COMD held above what the curves are owed (rescuable any time).
    function comdSurplus() public view returns (uint256) {
        uint256 bal = comd.balanceOf(address(this));
        return bal > totalBacking ? bal - totalBacking : 0;
    }

    /// @notice ETH held above what launchers are owed (rescuable any time).
    function ethSurplus() public view returns (uint256) {
        uint256 bal = address(this).balance;
        return bal > totalLauncherEthOwed ? bal - totalLauncherEthOwed : 0;
    }

    // =====================================================================================
    //                                      graduation
    // =====================================================================================

    /// @notice Move an eligible coin (reserve ≥ threshold) to its Uniswap v4 $COMD pool. Permissionless.
    function graduate(address coin) external nonReentrant whenNotPaused {
        Coin storage c = _coin(coin);
        if (_grads[coin].done) revert CoinGraduated();
        if (address(graduationHook) == address(0)) revert HookNotSet();
        if (c.comdReserve < graduationThreshold) revert NotEligible(c.comdReserve, graduationThreshold);
        _graduate(coin, c);
    }

    /// @notice Collect the pool's accrued swap fees: $COMD → Counsel rewards, coin → burned. Permissionless.
    function collectPoolFees(address coin) external nonReentrant returns (uint256 comdToRewards, uint256 coinBurned) {
        Graduation storage g = _grads[coin];
        if (!g.done) revert NotGraduated();
        (uint256 a0, uint256 a1) = abi.decode(poolManager.unlock(abi.encode(OP_COLLECT, coin)), (uint256, uint256));
        bool coinIs0 = Currency.unwrap(g.key.currency0) == coin;
        comdToRewards = coinIs0 ? a1 : a0;
        coinBurned = coinIs0 ? a0 : a1;
        if (comdToRewards > 0) {
            comd.safeTransfer(rewardDistributor, comdToRewards);
            totalToRewards += comdToRewards;
            g.feesComd += comdToRewards;
        }
        if (coinBurned > 0) {
            IERC20(coin).safeTransfer(DEAD, coinBurned);
            g.feesCoin += coinBurned;
        }
        emit PoolFeesCollected(coin, comdToRewards, coinBurned);
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (uint8 op, address coin) = abi.decode(data, (uint8, address));
        Graduation storage g = _grads[coin];
        PoolKey memory key = g.key;
        if (op == OP_SEED) {
            (BalanceDelta d,) = poolManager.modifyLiquidity(
                key, ModifyLiquidityParams(g.tickLower, g.tickUpper, int256(uint256(g.liquidity)), bytes32(0)), ""
            );
            uint256 owe0 = d.amount0() < 0 ? uint256(uint128(-d.amount0())) : 0;
            uint256 owe1 = d.amount1() < 0 ? uint256(uint128(-d.amount1())) : 0;
            _settle(key.currency0, owe0);
            _settle(key.currency1, owe1);
            return abi.encode(owe0, owe1);
        }
        (BalanceDelta f,) =
            poolManager.modifyLiquidity(key, ModifyLiquidityParams(g.tickLower, g.tickUpper, 0, bytes32(0)), "");
        uint256 f0 = f.amount0() > 0 ? uint256(uint128(f.amount0())) : 0;
        uint256 f1 = f.amount1() > 0 ? uint256(uint128(f.amount1())) : 0;
        if (f0 > 0) poolManager.take(key.currency0, address(this), f0);
        if (f1 > 0) poolManager.take(key.currency1, address(this), f1);
        return abi.encode(f0, f1);
    }

    function _settle(Currency cur, uint256 amount) internal {
        if (amount == 0) return;
        poolManager.sync(cur);
        IERC20(Currency.unwrap(cur)).safeTransfer(address(poolManager), amount);
        poolManager.settle();
    }

    function _maybeGraduate(address coin, Coin storage c) internal {
        if (address(graduationHook) == address(0)) return;
        if (c.comdReserve < graduationThreshold) return;
        _graduate(coin, c);
    }

    /// @dev Checks-effects first (reserves zeroed, backing released), then the pool. The curve price, which
    ///      includes the virtual COMD, becomes the pool's opening price, so graduation never moves the price;
    ///      the real COMD is therefore the binding side and the coins it cannot pair with are burned.
    function _graduate(address coin, Coin storage c) internal {
        Graduation storage g = _grads[coin];
        uint256 comdAmt = c.comdReserve;
        uint256 coinAmt = c.coinReserve;
        uint160 sqrtP = _plan(g, coin, c.virtualComd + comdAmt, comdAmt, coinAmt);
        if (g.liquidity == 0) revert ZeroAmount();

        c.comdReserve = 0;
        c.coinReserve = 0;
        totalBacking -= comdAmt;
        g.done = true;
        g.at = uint64(block.timestamp);
        ++graduatedCount;

        poolManager.initialize(g.key, sqrtP);
        (uint256 used0, uint256 used1) = abi.decode(poolManager.unlock(abi.encode(OP_SEED, coin)), (uint256, uint256));
        _finish(g, coin, coinAmt, used0, used1, sqrtP);
    }

    /// @dev Pool key, full-range ticks, opening price and the liquidity the reserves can fund (written into `g`).
    function _plan(Graduation storage g, address coin, uint256 x, uint256 comdAmt, uint256 coinAmt)
        internal
        returns (uint160 sqrtP)
    {
        bool coinIs0 = coin < address(comd);
        int24 spacing = graduationTickSpacing;
        g.key = coinIs0
            ? PoolKey(Currency.wrap(coin), Currency.wrap(address(comd)), graduationFee, spacing, graduationHook)
            : PoolKey(Currency.wrap(address(comd)), Currency.wrap(coin), graduationFee, spacing, graduationHook);
        // pool price = currency1 per currency0: COMD per coin when the coin is currency0, coins per COMD otherwise
        sqrtP = _sqrtPriceX96(coinIs0 ? coinAmt : x, coinIs0 ? x : coinAmt);
        g.tickLower = TickAlign.minUsable(spacing);
        g.tickUpper = TickAlign.maxUsable(spacing);
        g.liquidity = LiquidityAmountsLib.forAmounts(
            sqrtP,
            TickMath.getSqrtPriceAtTick(g.tickLower),
            TickMath.getSqrtPriceAtTick(g.tickUpper),
            coinIs0 ? coinAmt : comdAmt,
            coinIs0 ? comdAmt : coinAmt
        );
    }

    /// @dev Records what the pool took, burns the unsold coins the COMD could not pair with, emits.
    function _finish(Graduation storage g, address coin, uint256 coinAmt, uint256 used0, uint256 used1, uint160 sqrtP)
        internal
    {
        if (Currency.unwrap(g.key.currency0) == coin) {
            g.coinIn = used0;
            g.comdIn = used1;
        } else {
            g.coinIn = used1;
            g.comdIn = used0;
        }
        g.coinBurned = coinAmt - g.coinIn;
        if (g.coinBurned > 0) IERC20(coin).safeTransfer(DEAD, g.coinBurned);
        // COMD rounding dust (a few wei) stays as surplus
        emit Graduated(coin, PoolId.unwrap(g.key.toId()), sqrtP, g.comdIn, g.coinIn, g.coinBurned, g.liquidity);
    }

    /// @dev sqrt(amount1 / amount0) in Q64.96, clamped to the pool manager's bounds.
    function _sqrtPriceX96(uint256 amount0, uint256 amount1) internal pure returns (uint160) {
        uint256 ratioX192 = FullMath.mulDiv(amount1, uint256(1) << 192, amount0);
        uint256 s = Math.sqrt(ratioX192);
        if (s < TickMath.MIN_SQRT_PRICE + 1) s = TickMath.MIN_SQRT_PRICE + 1;
        if (s > TickMath.MAX_SQRT_PRICE - 1) s = TickMath.MAX_SQRT_PRICE - 1;
        return uint160(s);
    }

    // =====================================================================================
    //                                        owner
    // =====================================================================================

    /// @notice Set the graduation hook once: a LaunchGuardHook whose `factory()` is this contract. Owner, or the
    ///         installer (deployer) while unset.
    function setGraduationHook(IHooks hook) external {
        if (msg.sender != owner() && msg.sender != installer) revert NotInstaller();
        if (address(graduationHook) != address(0)) revert AlreadySet();
        if (address(hook) == address(0)) revert ZeroAddress();
        if (LaunchGuardHook(address(hook)).factory() != address(this)) revert BadHook();
        graduationHook = hook;
        emit GraduationHookSet(address(hook));
    }

    /// @notice COMD reserve at which a coin graduates (applies to every coin still on the curve).
    function setGraduationThreshold(uint256 t) external onlyOwner {
        if (t < MIN_GRADUATION || t > MAX_GRADUATION) revert OutOfBounds();
        graduationThreshold = t;
        emit GraduationThresholdSet(t);
    }

    /// @notice Pool fee tier for future graduations: 500/10, 3000/60 or 10000/200.
    function setGraduationFee(uint24 fee, int24 spacing) external onlyOwner {
        bool ok = (fee == 500 && spacing == 10) || (fee == 3_000 && spacing == 60) || (fee == 10_000 && spacing == 200);
        if (!ok) revert BadFee();
        graduationFee = fee;
        graduationTickSpacing = spacing;
        emit GraduationFeeSet(fee, spacing);
    }

    function setVirtualComd(uint256 v) external onlyOwner {
        if (v < MIN_VIRTUAL || v > MAX_VIRTUAL) revert OutOfBounds();
        virtualComd = v;
        emit VirtualComdSet(v);
    }

    /// @notice Point ETH trades at the ETH↔COMD venue (after the Pons graduation). 0 disables ETH trades.
    function setSwapper(address s) external onlyOwner {
        _setSwapper(s);
    }

    function _setSwapper(address s) internal {
        address old = address(swapper);
        if (old != address(0)) comd.forceApprove(old, 0);
        swapper = IBuybackSwapper(s);
        if (s != address(0)) comd.forceApprove(s, type(uint256).max);
        emit SwapperSet(s);
    }

    // ------------------------------------------------------------ safety nets

    /// @notice Freeze creation and trading. Launcher ETH claims keep working.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume trading — only if the contract is solvent (backing and launcher ETH fully present).
    function unpause() external onlyOwner {
        uint256 cb = comd.balanceOf(address(this));
        uint256 eb = address(this).balance;
        if (cb < totalBacking || eb < totalLauncherEthOwed) revert Insolvent(cb, totalBacking, eb, totalLauncherEthOwed);
        _unpause();
    }

    /// @notice Recover surplus only: COMD above `totalBacking`, a company coin above its `coinReserve`, other tokens
    ///         fully. Never touches what traders or launchers are owed.
    function rescueERC20(IERC20 token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 surplus;
        if (token == comd) {
            surplus = comdSurplus();
        } else if (_coins[address(token)].creator != address(0)) {
            uint256 bal = token.balanceOf(address(this));
            uint256 reserve = _coins[address(token)].coinReserve;
            surplus = bal > reserve ? bal - reserve : 0;
        } else {
            surplus = token.balanceOf(address(this));
        }
        if (amount > surplus) revert ExceedsSurplus(surplus, amount);
        token.safeTransfer(to, amount);
        emit Rescued(address(token), to, amount);
    }

    /// @notice Recover ETH above what launchers are owed.
    function rescueETH(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 surplus = ethSurplus();
        if (amount > surplus) revert ExceedsSurplus(surplus, amount);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Rescued(address(0), to, amount);
    }

    /// @notice Step 1 of the true-emergency path: start the 48 h countdown. Requires the contract to be paused.
    function scheduleEmergencyWithdraw() external onlyOwner whenPaused {
        emergencyWithdrawAt = block.timestamp + EMERGENCY_DELAY;
        emit EmergencyWithdrawScheduled(emergencyWithdrawAt);
    }

    function cancelEmergencyWithdraw() external onlyOwner {
        emergencyWithdrawAt = 0;
        emit EmergencyWithdrawCancelled();
    }

    /// @notice Step 2: after the countdown, while still paused, move ALL COMD and ETH to `to`. Accounting is left
    ///         untouched so `unpause()` keeps refusing until the owner has restored the backing.
    function emergencyWithdraw(address to) external onlyOwner whenPaused nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 at = emergencyWithdrawAt;
        if (at == 0) revert NotScheduled();
        if (block.timestamp < at) revert TooEarly(at);
        emergencyWithdrawAt = 0;
        uint256 cb = comd.balanceOf(address(this));
        uint256 eb = address(this).balance;
        if (cb > 0) comd.safeTransfer(to, cb);
        if (eb > 0) {
            (bool ok,) = to.call{value: eb}("");
            if (!ok) revert TransferFailed();
        }
        emit EmergencyWithdrawn(to, cb, eb);
    }

    // =====================================================================================
    //                                       internals
    // =====================================================================================

    function _coin(address coin) internal view returns (Coin storage c) {
        c = _coins[coin];
        if (c.creator == address(0)) revert UnknownCoin();
    }

    /// @dev A known coin that is still on the curve.
    function _live(address coin) internal view returns (Coin storage c) {
        c = _coin(coin);
        if (_grads[coin].done) revert CoinGraduated();
    }

    function _oweLauncher(address creator, uint256 amount) internal {
        launcherEthOwed[creator] += amount;
        totalLauncherEthOwed += amount;
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
        uint256 f = (amount * REWARDS_BPS) / BPS + (amount * BURN_BPS) / BPS;
        if (comdTrade) f += (amount * LAUNCHER_BPS) / BPS;
        return f;
    }

    /// @dev Takes the COMD-side fees out of `amount` held by this contract; returns the total taken.
    function _takeFees(address coin, address creator, uint256 amount, bool comdTrade)
        internal
        returns (uint256 total)
    {
        uint256 toRewards = (amount * REWARDS_BPS) / BPS;
        uint256 burned = (amount * BURN_BPS) / BPS;
        uint256 toLauncher = comdTrade ? (amount * LAUNCHER_BPS) / BPS : 0;
        if (toRewards > 0) comd.safeTransfer(rewardDistributor, toRewards);
        if (burned > 0) comd.safeTransfer(DEAD, burned);
        if (toLauncher > 0) comd.safeTransfer(creator, toLauncher);
        totalToRewards += toRewards;
        totalBurned += burned;
        total = toRewards + burned + toLauncher;
        emit Fees(coin, toRewards, burned, toLauncher, 0);
    }
}
