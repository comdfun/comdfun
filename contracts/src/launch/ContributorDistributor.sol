// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ContributorDistributor — the swarm's 10% of every launched token
/// @notice UNAUDITED — experimental. Do not use with funds you cannot afford to lose.
/// @notice One Merkle root per launch, registered once by the ProjectFactory together with the tokens.
///         The deployer service builds the root off-chain under the launch policy ("equal_connected"):
///         2% of supply equally among wallets with accepted work on the launch, 8% equally among seats
///         connected in the recent window, each wallet capped at perWalletCapBps (30%) of the pool —
///         the cap is enforced OFF-CHAIN when building the root; this contract only checks the proof.
///         Claims open at `unlockAt(launchId)` (launch time + contributorLockSeconds, 1 h) and never expire.
///         Anyone may submit a claim; tokens always go to `account`.
///         Safety net (V7): the factory (its admin) can `rescue` only the surplus above `reserved[token]`.
/// @dev Leaf = keccak256(bytes.concat(keccak256(abi.encode(launchId, account, amount)))) (OZ StandardMerkleTree
///      with types ["uint256","address","uint256"]).
contract ContributorDistributor is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Allocation {
        address token;
        bytes32 root;
        uint128 total;
        uint128 claimed;
        uint64 unlockAt;
    }

    address public immutable factory;
    mapping(uint256 => Allocation) internal _allocations;
    mapping(uint256 => mapping(address => bool)) public claimed;
    /// @notice token => amount still owed to claimants across all launches of that token (never rescuable).
    mapping(address => uint256) public reserved;

    event Registered(uint256 indexed launchId, address indexed token, bytes32 root, uint256 total, uint64 unlockAt);
    event Claimed(uint256 indexed launchId, address indexed account, uint256 amount);
    event Rescued(address indexed token, address indexed to, uint256 amount);

    error NotFactory();
    error AlreadyRegistered();
    error UnknownLaunch();
    error Locked(uint64 unlockAt);
    error AlreadyClaimed();
    error InvalidProof();
    error ExceedsTotal();
    error ExceedsSurplus(uint256 surplus, uint256 requested);
    error TransferFailed();

    constructor(address factory_) {
        factory = factory_;
    }

    /// @notice Factory-only: pull `total` of `token` from the factory and set the launch's root.
    function register(uint256 launchId, address token, bytes32 root, uint256 total, uint64 unlockAt_) external {
        if (msg.sender != factory) revert NotFactory();
        if (_allocations[launchId].token != address(0)) revert AlreadyRegistered();
        _allocations[launchId] = Allocation(token, root, uint128(total), 0, unlockAt_);
        reserved[token] += total;
        IERC20(token).safeTransferFrom(msg.sender, address(this), total);
        emit Registered(launchId, token, root, total, unlockAt_);
    }

    function claim(uint256 launchId, address account, uint256 amount, bytes32[] calldata proof) external nonReentrant {
        Allocation storage a = _allocations[launchId];
        if (a.token == address(0)) revert UnknownLaunch();
        if (block.timestamp < a.unlockAt) revert Locked(a.unlockAt);
        if (claimed[launchId][account]) revert AlreadyClaimed();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(launchId, account, amount))));
        if (!MerkleProof.verifyCalldata(proof, a.root, leaf)) revert InvalidProof();
        if (uint256(a.claimed) + amount > a.total) revert ExceedsTotal();
        claimed[launchId][account] = true;
        a.claimed += uint128(amount);
        reserved[a.token] -= amount;
        IERC20(a.token).safeTransfer(account, amount);
        emit Claimed(launchId, account, amount);
    }

    /// @notice Factory-only (its admin calls `ProjectFactory.rescueFromDistributor`): recover tokens above what
    ///         claimants are owed (`reserved[token]`), or any ETH forced in. Allocated tokens can never be taken.
    function rescue(address token, address to, uint256 amount) external nonReentrant {
        if (msg.sender != factory) revert NotFactory();
        if (token == address(0)) {
            if (amount > address(this).balance) revert ExceedsSurplus(address(this).balance, amount);
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            uint256 bal = IERC20(token).balanceOf(address(this));
            uint256 surplus = bal > reserved[token] ? bal - reserved[token] : 0;
            if (amount > surplus) revert ExceedsSurplus(surplus, amount);
            IERC20(token).safeTransfer(to, amount);
        }
        emit Rescued(token, to, amount);
    }

    function unlockAt(uint256 launchId) external view returns (uint256) {
        return _allocations[launchId].unlockAt;
    }

    function allocations(uint256 launchId) external view returns (Allocation memory) {
        return _allocations[launchId];
    }
}
