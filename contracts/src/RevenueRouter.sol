// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title RevenueRouter — payTo of every Company.md job payment (x402 + Permit2, paid in COMD)
/// @notice Reviewed before launch: an internal security review plus an independent security review (contracts/AUDIT.md).
/// @notice Anyone calls `distribute()`: the COMD balance is split `rewardsBps` (default 80%) to the RewardDistributor
///         (Counsel rewards, split per epoch by accepted work) and the rest (default 20%) to the firm treasury
///         (compute + gas). No swaps. Receiving COMD (a plain ERC-20 transfer from Permit2) is never blocked.
/// @notice Owner powers (Ownable2Step, renounceable): `setBps(rewardsBps)` within [5000, 10000] (Counsel always get
///         at least half); `setTreasury`. The RewardDistributor and the token are immutable.
///         **Safety nets (V7):** `pause()` stops `distribute`; `rescueERC20(token, to, amount)` recovers any token —
///         for COMD itself only while paused (an explicit two-step emergency, visible on-chain as Paused + Rescued),
///         so day-to-day revenue can only ever leave through `distribute()`.
contract RevenueRouter is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint16 public constant MIN_REWARDS_BPS = 5_000;

    IERC20 public immutable comd;
    address public immutable rewardDistributor;
    address public treasury;
    uint16 public rewardsBps = 8_000;

    uint256 public totalToRewards;
    uint256 public totalToTreasury;

    event Distributed(uint256 total, uint256 toRewards, uint256 toTreasury);
    event BpsSet(uint16 rewardsBps, uint16 treasuryBps);
    event TreasurySet(address treasury);
    event Rescued(address indexed token, address indexed to, uint256 amount);

    error ZeroAddress();
    error BadBps();
    error NothingToDistribute();
    error PauseFirst();

    constructor(IERC20 comd_, address rewardDistributor_, address treasury_, address owner_) Ownable(owner_) {
        if (address(comd_) == address(0) || rewardDistributor_ == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        comd = comd_;
        rewardDistributor = rewardDistributor_;
        treasury = treasury_;
    }

    /// @notice (rewardsBps, treasuryBps)
    function bps() external view returns (uint16, uint16) {
        return (rewardsBps, uint16(BPS - rewardsBps));
    }

    function distribute() external nonReentrant whenNotPaused returns (uint256 toRewards, uint256 toTreasury) {
        uint256 total = comd.balanceOf(address(this));
        if (total == 0) revert NothingToDistribute();
        toRewards = (total * rewardsBps) / BPS;
        toTreasury = total - toRewards;
        if (toRewards > 0) comd.safeTransfer(rewardDistributor, toRewards);
        if (toTreasury > 0) comd.safeTransfer(treasury, toTreasury);
        totalToRewards += toRewards;
        totalToTreasury += toTreasury;
        emit Distributed(total, toRewards, toTreasury);
    }

    function setBps(uint16 rewardsBps_) external onlyOwner {
        if (rewardsBps_ < MIN_REWARDS_BPS || rewardsBps_ > BPS) revert BadBps();
        rewardsBps = rewardsBps_;
        emit BpsSet(rewardsBps_, uint16(BPS - rewardsBps_));
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasurySet(t);
    }

    // ------------------------------------------------------------ safety nets

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Recover tokens. COMD (the revenue itself) can only be rescued while paused.
    function rescueERC20(IERC20 token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (token == comd && !paused()) revert PauseFirst();
        token.safeTransfer(to, amount);
        emit Rescued(address(token), to, amount);
    }
}
