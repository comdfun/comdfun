// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IMarketplaceAdapter} from "./interfaces/IMarketplaceAdapter.sol";
import {IBuybackSwapper} from "./interfaces/IBuybackSwapper.sol";

/// @title Flywheel — where the $COMD tax goes (Pons mode)
/// @notice UNAUDITED — experimental. Do not use with funds you cannot afford to lose.
/// @notice $COMD is launched on Pons, which pays the creator wallet in ETH (the 5% tax + its fee share). That ETH
///         is forwarded here: `receive()` (or `notifyTax()`) accepts ETH from anyone and splits every wei into two
///         buckets by bps (default buyback 5000 / floor sweep 5000):
///         - **buyback**: keeper `buyback(minOut)` swaps the whole bucket ETH→COMD through the pluggable
///           `IBuybackSwapper` (owner `setSwapper`; reverts `SwapperNotSet()` until configured, ETH just accumulates)
///           and sends every COMD received to the dead address 0x…dEaD (the Pons token may have no `burn()`).
///         - **floor sweep**: keeper `sweep(adapter, data, tokenId, maxPrice)` buys one Company.md Counsel NFT
///           through an owner-allowlisted IMarketplaceAdapter, paying at most min(maxPrice, maxSweepPrice, bucket).
///           Swept NFTs are held here ("the firm's vault"); the owner re-issues them with `awardSwept`.
///         Conservation (tested as an invariant): totalTaxIn == buyback + sweep buckets + totalBoughtBack + sweepSpent.
/// @notice Owner powers (Ownable2Step, renounceable): bps split (sum 10000; applies to future tax), maxSweepPrice,
///         adapter allowlist, keeper, swapper (re-pointable), `awardSwept` (give a swept NFT to anyone), `setComd`
///         (once, only if the Flywheel was deployed before the Pons launch with comd = 0).
///         Keeper powers: choose the buyback `minOut` (a careless/compromised keeper can be sandwiched) and choose
///         which listing to sweep, bounded by `maxSweepPrice`. Nobody can withdraw bucket ETH any other way.
///         The NFT collection is immutable.
contract Flywheel is Ownable2Step, ReentrancyGuard, IERC721Receiver {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IERC20 public comd;
    IERC721 public immutable counsel;

    IBuybackSwapper public swapper;
    address public keeper;

    uint16 public buybackBps = 5_000;
    uint16 public sweepBps = 5_000;

    uint256 public buybackBucket;
    uint256 public sweepBucket;

    uint256 public totalTaxIn;
    uint256 public totalBoughtBack; // ETH spent on buybacks
    uint256 public totalBurned; // COMD sent to the dead address by buybacks
    uint256 public totalSwept; // NFTs swept (cumulative)
    uint256 public sweepSpent; // ETH spent on sweeps

    uint256 public maxSweepPrice;
    mapping(address => bool) public adapterAllowed;

    uint256[] internal _swept;
    mapping(uint256 => uint256) internal _sweptPos; // tokenId => index + 1

    bool private _inOp;
    uint256 private _opRefund;

    event TaxIn(uint256 eth);
    event Buyback(uint256 ethIn, uint256 comdBurned);
    event Swept(uint256 tokenId, uint256 price);
    event SweptAwarded(uint256 indexed tokenId, address indexed to);
    event BpsSet(uint16 buybackBps, uint16 sweepBps);
    event MaxSweepPriceSet(uint256 maxSweepPrice);
    event AdapterSet(address indexed adapter, bool allowed);
    event KeeperSet(address keeper);
    event SwapperSet(address swapper);
    event ComdSet(address comd);

    error NotKeeper();
    error BadBps();
    error Empty();
    error AdapterNotAllowed();
    error PriceTooHigh();
    error NotDelivered();
    error AlreadyHeld();
    error NotSwept();
    error NotCounsel();
    error AlreadySet();
    error ZeroAddress();
    error TransferFailed();
    error SwapperNotSet();
    error ComdNotSet();
    error NothingReceived();

    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _;
    }

    /// @param comd_ the Pons $COMD token; may be address(0) when deploying before the launch (then `setComd` once)
    constructor(IERC20 comd_, IERC721 counsel_, address owner_, address keeper_) Ownable(owner_) {
        if (address(counsel_) == address(0)) revert ZeroAddress();
        comd = comd_;
        counsel = counsel_;
        keeper = keeper_;
        maxSweepPrice = 0.5 ether;
    }

    // =====================================================================================
    //                                        tax in
    // =====================================================================================

    /// @notice ETH from anyone (Pons creator payouts forwarded here, or the Flywheel set as the recipient).
    ///         During our own buyback/sweep the incoming ETH is the venue's refund, not tax.
    receive() external payable {
        if (_inOp) {
            _opRefund += msg.value;
            return;
        }
        _taxIn(msg.value);
    }

    /// @notice Alias of `receive()` for explicit forwards.
    function notifyTax() external payable {
        _taxIn(msg.value);
    }

    function _taxIn(uint256 v) private {
        if (v == 0) return;
        uint256 b = (v * buybackBps) / BPS;
        buybackBucket += b;
        sweepBucket += v - b;
        totalTaxIn += v;
        emit TaxIn(v);
    }

    // =====================================================================================
    //                                       buyback
    // =====================================================================================

    /// @notice Swap the whole buyback bucket ETH→COMD through the swapper and send the COMD to the dead address.
    /// @return burned COMD actually received and sent to 0x…dEaD (measured by balance, not trusted from the venue)
    function buyback(uint256 minOut) external onlyKeeper nonReentrant returns (uint256 burned) {
        if (address(swapper) == address(0)) revert SwapperNotSet();
        if (address(comd) == address(0)) revert ComdNotSet();
        uint256 amt = buybackBucket;
        if (amt == 0) revert Empty();
        buybackBucket = 0;
        uint256 bal0 = comd.balanceOf(address(this));
        _beginOp();
        swapper.swapExactETHForComd{value: amt}(minOut, address(this), block.timestamp);
        uint256 refund = _endOp();
        if (refund > amt) revert TransferFailed();
        burned = comd.balanceOf(address(this)) - bal0;
        if (burned == 0 || burned < minOut) revert NothingReceived();
        uint256 spent = amt - refund;
        buybackBucket += refund;
        comd.safeTransfer(DEAD, burned);
        totalBoughtBack += spent;
        totalBurned += burned;
        emit Buyback(spent, burned);
    }

    // =====================================================================================
    //                                      floor sweep
    // =====================================================================================

    function sweep(address adapter, bytes calldata data, uint256 tokenId, uint256 maxPrice)
        external
        onlyKeeper
        nonReentrant
        returns (uint256 spent)
    {
        if (!adapterAllowed[adapter]) revert AdapterNotAllowed();
        if (maxPrice > maxSweepPrice) revert PriceTooHigh();
        if (maxPrice > sweepBucket) revert Empty();
        if (_sweptPos[tokenId] != 0) revert AlreadyHeld();
        sweepBucket -= maxPrice;
        _beginOp();
        IMarketplaceAdapter(adapter).buy{value: maxPrice}(address(counsel), tokenId, maxPrice, address(this), data);
        uint256 refund = _endOp();
        if (refund > maxPrice) revert TransferFailed();
        if (counsel.ownerOf(tokenId) != address(this)) revert NotDelivered();
        spent = maxPrice - refund;
        sweepBucket += refund;
        _swept.push(tokenId);
        _sweptPos[tokenId] = _swept.length;
        totalSwept += 1;
        sweepSpent += spent;
        emit Swept(tokenId, spent);
    }

    /// @notice Owner re-issues a swept Counsel (e.g. to top counsel).
    function awardSwept(uint256 tokenId, address to) external onlyOwner nonReentrant {
        uint256 pos = _sweptPos[tokenId];
        if (pos == 0) revert NotSwept();
        if (to == address(0)) revert ZeroAddress();
        uint256 last = _swept[_swept.length - 1];
        _swept[pos - 1] = last;
        _sweptPos[last] = pos;
        _swept.pop();
        delete _sweptPos[tokenId];
        counsel.safeTransferFrom(address(this), to, tokenId);
        emit SweptAwarded(tokenId, to);
    }

    /// @dev Accept Company.md Counsel only.
    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(counsel)) revert NotCounsel();
        return IERC721Receiver.onERC721Received.selector;
    }

    // =====================================================================================
    //                                         owner
    // =====================================================================================

    function setBps(uint16 buyback_, uint16 sweep_) external onlyOwner {
        if (uint256(buyback_) + sweep_ != BPS) revert BadBps();
        buybackBps = buyback_;
        sweepBps = sweep_;
        emit BpsSet(buyback_, sweep_);
    }

    function setMaxSweepPrice(uint256 p) external onlyOwner {
        maxSweepPrice = p;
        emit MaxSweepPriceSet(p);
    }

    function setAdapter(address adapter, bool allowed) external onlyOwner {
        adapterAllowed[adapter] = allowed;
        emit AdapterSet(adapter, allowed);
    }

    function setKeeper(address k) external onlyOwner {
        keeper = k;
        emit KeeperSet(k);
    }

    /// @notice Point at the ETH↔COMD venue (configured after the Pons graduation). Re-pointable; 0 disables buybacks.
    function setSwapper(address s) external onlyOwner {
        swapper = IBuybackSwapper(s);
        emit SwapperSet(s);
    }

    /// @notice Set the Pons token once, if the Flywheel was deployed before the launch.
    function setComd(address c) external onlyOwner {
        if (address(comd) != address(0)) revert AlreadySet();
        if (c == address(0)) revert ZeroAddress();
        comd = IERC20(c);
        emit ComdSet(c);
    }

    // =====================================================================================
    //                                         views
    // =====================================================================================

    /// @notice (buybackBps, sweepBps)
    function bps() external view returns (uint16, uint16) {
        return (buybackBps, sweepBps);
    }

    /// @notice (buyback bucket ETH, sweep bucket ETH)
    function bucketBalances() external view returns (uint256, uint256) {
        return (buybackBucket, sweepBucket);
    }

    /// @notice Counsel token ids currently held by the Flywheel.
    function sweptTokenIds() external view returns (uint256[] memory) {
        return _swept;
    }

    // =====================================================================================
    //                                       internals
    // =====================================================================================

    function _beginOp() private {
        _inOp = true;
        _opRefund = 0;
    }

    function _endOp() private returns (uint256 refund) {
        refund = _opRefund;
        _opRefund = 0;
        _inOp = false;
    }
}
