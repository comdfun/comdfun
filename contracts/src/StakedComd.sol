// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title StakedComd — sCOMD (Company.md staking shares)
/// @notice UNAUDITED — experimental. Do not use with funds you cannot afford to lose.
/// @notice ERC-4626 vault over COMD. No lock-up. Rewards arrive as plain COMD transfers from the
///         RewardDripper, which raises the assets behind every share ("your share count stays put; the
///         backing grows").
/// @notice One-block hold: shares minted to an account in block N (deposit/mint) cannot be redeemed, withdrawn
///         or transferred until block N+1. This blocks atomic deposit → drip → withdraw. Only the shares minted
///         in the current block are held — the rest of the receiver's balance stays free — so a deposit made
///         FOR someone else cannot freeze their existing stake (security review M-02). Receiving a transfer
///         does not start a hold. `block.number` on Robinhood Chain (Arbitrum Orbit) is the parent-chain block.
/// @notice Owner powers (all vanish on `renounceOwnership`): pause/unpause deposits and withdrawals,
///         sweep tokens that are NOT the vault asset. The owner can never move staked COMD.
///         Ownership cannot be renounced while paused (that would freeze the vault forever).
/// @dev Inflation/donation resistance: OZ virtual shares with `_decimalsOffset() = 6` (sCOMD has 24 decimals).
contract StakedComd is ERC4626, Ownable2Step, Pausable {
    using SafeERC20 for IERC20;

    mapping(address => uint256) public lastDepositBlock;
    /// @notice Shares minted to an account in block `lastDepositBlock[account]` (held until the next block).
    mapping(address => uint256) public heldShares;

    error SameBlockHold();
    error CannotSweepAsset();
    error RenounceWhilePaused();

    event Swept(address indexed token, address indexed to, uint256 amount);

    constructor(IERC20 comd, address initialOwner)
        ERC20("Staked COMD", "sCOMD")
        ERC4626(comd)
        Ownable(initialOwner)
    {}

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    function decimals() public view override(ERC4626) returns (uint8) {
        return super.decimals();
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
        whenNotPaused
    {
        if (lastDepositBlock[receiver] != block.number) {
            lastDepositBlock[receiver] = block.number;
            heldShares[receiver] = shares;
        } else {
            heldShares[receiver] += shares;
        }
        super._deposit(caller, receiver, assets, shares);
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
        whenNotPaused
    {
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && lastDepositBlock[from] == block.number) {
            // only the shares minted this block are held
            uint256 bal = balanceOf(from);
            uint256 held = heldShares[from];
            if (bal < held || bal - held < value) revert SameBlockHold();
        }
        super._update(from, to, value);
    }

    /// @notice ERC-4626: shares `owner` can redeem right now (0 while paused; excludes this block's held shares).
    function maxRedeem(address owner) public view override returns (uint256) {
        if (paused()) return 0;
        uint256 bal = balanceOf(owner);
        if (lastDepositBlock[owner] != block.number) return bal;
        uint256 held = heldShares[owner];
        return bal > held ? bal - held : 0;
    }

    /// @notice ERC-4626: assets `owner` can withdraw right now (see `maxRedeem`).
    function maxWithdraw(address owner) public view override returns (uint256) {
        return _convertToAssets(maxRedeem(owner), Math.Rounding.Floor);
    }

    /// @notice ERC-4626: 0 while paused.
    function maxDeposit(address receiver) public view override returns (uint256) {
        return paused() ? 0 : super.maxDeposit(receiver);
    }

    /// @notice ERC-4626: 0 while paused.
    function maxMint(address receiver) public view override returns (uint256) {
        return paused() ? 0 : super.maxMint(receiver);
    }

    // ------------------------------------------------------------------- owner

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Rescue tokens sent here by mistake. The vault asset (COMD) cannot be swept.
    function sweep(IERC20 token, address to, uint256 amount) external onlyOwner {
        if (address(token) == asset()) revert CannotSweepAsset();
        token.safeTransfer(to, amount);
        emit Swept(address(token), to, amount);
    }

    function renounceOwnership() public override onlyOwner {
        if (paused()) revert RenounceWhilePaused();
        super.renounceOwnership();
    }
}
