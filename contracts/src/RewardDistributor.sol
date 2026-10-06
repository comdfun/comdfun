// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title RewardDistributor — Counsel seat rewards by epoch
/// @notice UNAUDITED — experimental. Do not use with funds you cannot afford to lose.
/// @notice Receives Counsel rewards in COMD (the external Pons token, plain ERC-20 transfers): 80% of job payments
///         via RevenueRouter and the 1% Incorporations fee. Any ERC-20 can be distributed; asset address(0) means
///         native ETH (anyone may send ETH here, e.g. grants).
///         The settler posts one Merkle root per (epoch, asset) with the root's total, which must be covered
///         by the asset's unallocated balance. Claims always pay the CURRENT owner of the Counsel token id
///         (CounselNFT.ownerOf), so unclaimed rewards travel with the NFT. Anyone may submit a claim.
/// @dev Leaf = keccak256(bytes.concat(keccak256(abi.encode(epoch, tokenId, amount)))) for every asset;
///      the asset is bound by the root (one root per (epoch, asset)), not by the leaf.
///      `claim` = COMD; `claimToken(asset, ...)` = any asset (incl. COMD; address(0) = ETH).
/// @notice Admin powers (DEFAULT_ADMIN_ROLE, renounceable): grant/revoke SETTLER_ROLE (hot-key rotation); expire an
///         epoch root after EXPIRY (365 days) so its unclaimed remainder becomes unallocated again.
///         Settler powers: post a root once per (epoch, asset); it cannot be changed afterwards. Claims against a
///         root are capped at its `total`, so a root can only ever spend the unallocated balance it reserved.
///         **Safety nets (V7):** admin `pause()` stops all claims (posting too); admin `revokeRoot(epoch, asset)`
///         cancels a wrong root at any time (its unclaimed remainder is released; the settler re-posts under a new
///         epoch id); admin `rescueERC20` / `rescueETH` move out **unallocated** balance only — funds committed to a
///         live root can only be reached by revoking that root first, which is a separate, evented action.
contract RewardDistributor is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");
    uint256 public constant EXPIRY = 365 days;

    struct Root {
        bytes32 root;
        uint128 total;
        uint128 claimed;
        uint64 postedAt;
        bool expired;
    }

    IERC20 public immutable comd;
    IERC721 public immutable counsel;

    /// @notice asset => amount committed to posted, unexpired roots and not yet claimed.
    mapping(address => uint256) public outstanding;
    mapping(uint256 => mapping(address => Root)) internal _roots;
    mapping(uint256 => mapping(address => mapping(uint256 => bool))) internal _claimed;

    event RootPosted(uint256 indexed epoch, address indexed asset, bytes32 root, uint256 total);
    event Claimed(uint256 indexed epoch, address indexed asset, uint256 indexed tokenId, address owner, uint256 amount);
    event EpochExpired(uint256 indexed epoch, address indexed asset, uint256 released);
    event RootRevoked(uint256 indexed epoch, address indexed asset, uint256 released);
    event Rescued(address indexed asset, address indexed to, uint256 amount);

    error RootExists();
    error NoRoot();
    error AlreadyClaimed();
    error InvalidProof();
    error InsufficientUnallocated(uint256 available, uint256 needed);
    error NotExpired();
    error ZeroAddress();
    error ExceedsTotal();

    error TransferFailed();

    constructor(IERC20 comd_, IERC721 counsel_, address admin) {
        if (address(comd_) == address(0) || address(counsel_) == address(0) || admin == address(0)) {
            revert ZeroAddress();
        }
        comd = comd_;
        counsel = counsel_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // --------------------------------------------------------------- settler

    /// @notice ETH for Counsel rewards (anyone).
    receive() external payable {}

    function postRoot(uint256 epoch, address asset, bytes32 root, uint256 total)
        external
        onlyRole(SETTLER_ROLE)
        whenNotPaused
    {
        Root storage r = _roots[epoch][asset];
        if (r.root != bytes32(0)) revert RootExists();
        if (root == bytes32(0)) revert NoRoot();
        uint256 avail = unallocated(asset);
        if (total > avail) revert InsufficientUnallocated(avail, total);
        if (total > type(uint128).max) revert ExceedsTotal();
        r.root = root;
        r.total = uint128(total);
        r.postedAt = uint64(block.timestamp);
        outstanding[asset] += total;
        emit RootPosted(epoch, asset, root, total);
    }

    // ----------------------------------------------------------------- claims

    /// @notice Claim COMD seat rewards of `tokenId` for `epoch`; pays the current NFT owner.
    function claim(uint256 epoch, uint256 tokenId, uint256 amount, bytes32[] calldata proof) external {
        _claim(address(comd), epoch, tokenId, amount, proof);
    }

    /// @notice Claim `asset` seat rewards (address(0) = ETH) of `tokenId` for `epoch`; pays the current NFT owner.
    function claimToken(address asset, uint256 epoch, uint256 tokenId, uint256 amount, bytes32[] calldata proof)
        external
    {
        _claim(asset, epoch, tokenId, amount, proof);
    }

    function _claim(address asset, uint256 epoch, uint256 tokenId, uint256 amount, bytes32[] calldata proof)
        internal
        nonReentrant
        whenNotPaused
    {
        Root storage r = _roots[epoch][asset];
        if (r.root == bytes32(0) || r.expired) revert NoRoot();
        if (_claimed[epoch][asset][tokenId]) revert AlreadyClaimed();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(epoch, tokenId, amount))));
        if (!MerkleProof.verifyCalldata(proof, r.root, leaf)) revert InvalidProof();
        // a root can never pay out more than the total it reserved (security review M-03): a faulty or
        // malicious root cannot reach funds committed to other roots
        if (uint256(r.claimed) + amount > r.total) revert ExceedsTotal();
        _claimed[epoch][asset][tokenId] = true;
        r.claimed += uint128(amount);
        outstanding[asset] -= amount;
        address owner = counsel.ownerOf(tokenId);
        if (asset == address(0)) {
            (bool ok,) = owner.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(asset).safeTransfer(owner, amount);
        }
        emit Claimed(epoch, asset, tokenId, owner, amount);
    }

    // ------------------------------------------------------------------ admin

    /// @notice Release the unclaimed remainder of an old root back to the unallocated balance.
    function expireEpoch(uint256 epoch, address asset) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Root storage r = _roots[epoch][asset];
        if (r.root == bytes32(0) || r.expired) revert NoRoot();
        if (block.timestamp < r.postedAt + EXPIRY) revert NotExpired();
        r.expired = true;
        uint256 rest = uint256(r.total) - r.claimed;
        outstanding[asset] -= rest;
        emit EpochExpired(epoch, asset, rest);
    }

    /// @notice Emergency: cancel a wrong root right away (no expiry wait). Already-paid claims stay paid; the
    ///         unclaimed remainder becomes unallocated; the settler posts the corrected tree under a NEW epoch id.
    function revokeRoot(uint256 epoch, address asset) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Root storage r = _roots[epoch][asset];
        if (r.root == bytes32(0) || r.expired) revert NoRoot();
        r.expired = true;
        uint256 rest = uint256(r.total) - r.claimed;
        outstanding[asset] -= rest;
        emit RootRevoked(epoch, asset, rest);
    }

    /// @notice Stop claims and root posting. Admin only.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Move **unallocated** `asset` out (what no live root has reserved). Revoke roots first to free more.
    function rescueERC20(IERC20 asset, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 avail = unallocated(address(asset));
        if (amount > avail) revert InsufficientUnallocated(avail, amount);
        asset.safeTransfer(to, amount);
        emit Rescued(address(asset), to, amount);
    }

    /// @notice Move **unallocated** ETH out. Revoke ETH roots first to free more.
    function rescueETH(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 avail = unallocated(address(0));
        if (amount > avail) revert InsufficientUnallocated(avail, amount);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Rescued(address(0), to, amount);
    }

    // ------------------------------------------------------------------ views

    function claimed(uint256 epoch, uint256 tokenId) external view returns (bool) {
        return _claimed[epoch][address(comd)][tokenId];
    }

    function claimedToken(address asset, uint256 epoch, uint256 tokenId) external view returns (bool) {
        return _claimed[epoch][asset][tokenId];
    }

    function roots(uint256 epoch, address asset) external view returns (Root memory) {
        return _roots[epoch][asset];
    }

    /// @notice Balance of `asset` (address(0) = ETH) not committed to any posted root.
    function unallocated(address asset) public view returns (uint256) {
        uint256 bal = asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
        uint256 out = outstanding[asset];
        return bal > out ? bal - out : 0;
    }
}
