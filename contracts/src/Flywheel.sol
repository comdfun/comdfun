// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IMarketplaceAdapter} from "./interfaces/IMarketplaceAdapter.sol";

interface IComdRouterLike {
    function swapExactETHForComd(uint256 minOut, address to, uint256 deadline) external payable returns (uint256);
}

/// @title Flywheel — where the 5% COMD/ETH pool tax goes
/// @notice UNAUDITED — experimental. Do not use with funds you cannot afford to lose.
/// @notice Receives the ETH tax from ComdTaxHook (`notifyTax`, hook only) and splits every wei into two buckets by
///         bps of the tax (default buyback 5000 / floor sweep 5000 = 2.5% / 2.5% of volume):
///         - **buyback**: keeper `buyback(minOut)` swaps the whole bucket ETH→COMD through ComdRouter (the hook
///           exempts this one path, so the buyback is not taxed into itself) and burns all COMD received.
///         - **floor sweep**: keeper `sweep(adapter, data, tokenId, maxPrice)` buys one Company.md Counsel NFT
///           through an owner-allowlisted IMarketplaceAdapter, paying at most min(maxPrice, maxSweepPrice, bucket).
///           Swept NFTs are held here ("the firm's vault"); the owner re-issues them with `awardSwept`.
///         Conservation (tested as an invariant): totalTaxIn == buyback + sweep buckets + totalBoughtBack + sweepSpent.
/// @notice Owner powers (Ownable2Step, renounceable): bps split (sum 10000; applies to future tax), maxSweepPrice,
///         adapter allowlist, keeper, `awardSwept` (give a swept NFT to anyone), hook and router (once each).
///         Keeper powers: choose the buyback `minOut` (a careless/compromised keeper can be sandwiched) and choose
///         which listing to sweep, bounded by `maxSweepPrice`. Nobody can withdraw bucket ETH any other way.
///         The NFT collection is immutable.
contract Flywheel is Ownable2Step, ReentrancyGuard, IERC721Receiver {
    uint256 public constant BPS = 10_000;

    ERC20Burnable public immutable comd;
    IERC721 public immutable counsel;

    address public hook;
    IComdRouterLike public router;
    address public keeper;

    uint16 public buybackBps = 5_000;
    uint16 public sweepBps = 5_000;

    uint256 public buybackBucket;
    uint256 public sweepBucket;

    uint256 public totalTaxIn;
    uint256 public totalBoughtBack; // ETH spent on buybacks
    uint256 public totalBurned; // COMD burned by buybacks
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
    event HookSet(address hook);
    event RouterSet(address router);

    error NotHook();
    error NotKeeper();
    error UnexpectedEth();
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

    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _;
    }

    constructor(ERC20Burnable comd_, IERC721 counsel_, address owner_, address keeper_) Ownable(owner_) {
        if (address(comd_) == address(0) || address(counsel_) == address(0)) revert ZeroAddress();
        comd = comd_;
        counsel = counsel_;
        keeper = keeper_;
        maxSweepPrice = 0.5 ether;
    }

    // =====================================================================================
    //                                        tax in
    // =====================================================================================

    function notifyTax() external payable {
        if (msg.sender != hook) revert NotHook();
        uint256 v = msg.value;
        uint256 b = (v * buybackBps) / BPS;
        buybackBucket += b;
        sweepBucket += v - b;
        totalTaxIn += v;
        emit TaxIn(v);
    }

    /// @dev Only refunds during our own buyback/sweep calls are accepted; stray ETH is refused.
    receive() external payable {
        if (!_inOp) revert UnexpectedEth();
        _opRefund += msg.value;
    }

    // =====================================================================================
    //                                       buyback
    // =====================================================================================

    function buyback(uint256 minOut) external onlyKeeper nonReentrant returns (uint256 burned) {
        uint256 amt = buybackBucket;
        if (amt == 0) revert Empty();
        buybackBucket = 0;
        _beginOp();
        burned = router.swapExactETHForComd{value: amt}(minOut, address(this), block.timestamp);
        uint256 refund = _endOp();
        uint256 spent = amt - refund;
        buybackBucket += refund;
        comd.burn(burned);
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

    function setHook(address h) external onlyOwner {
        if (hook != address(0)) revert AlreadySet();
        if (h == address(0)) revert ZeroAddress();
        hook = h;
        emit HookSet(h);
    }

    function setRouter(address r) external onlyOwner {
        if (address(router) != address(0)) revert AlreadySet();
        if (r == address(0)) revert ZeroAddress();
        router = IComdRouterLike(r);
        emit RouterSet(r);
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
