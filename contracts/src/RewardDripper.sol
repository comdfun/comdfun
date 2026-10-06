// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title RewardDripper — streams staker rewards into sCOMD
/// @notice UNAUDITED — experimental. Do not use with funds you cannot afford to lose.
/// @notice Holds COMD set aside for stakers (4.5% of every hook trim, 1% of Incorporations trades, or
///         anything sent / notified) and streams it linearly into the StakedComd vault.
///         Rate: ratePerSecond = min(streamCapPerDay, balance * 1 day / streamWindow) / 1 day.
///         `drip()` is permissionless; it releases rate * elapsed, where elapsed is capped at
///         `catchUpSeconds` (time nobody dripped beyond that buffer is not paid out in one jump).
///         Nothing streams while the vault has no shares (the rewards stay here until someone stakes).
/// @notice Owner powers (vanish on renounce): set the stream cap and window within bounds, re-point the
///         vault. Renouncing is blocked while no vault is set (it would freeze the stream).
contract RewardDripper is Ownable2Step {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_STREAM_CAP_PER_DAY = 100_000_000e18;
    uint256 public constant MIN_WINDOW = 1 days;
    uint256 public constant MAX_WINDOW = 365 days;
    uint256 public constant MAX_CATCH_UP = 1 days;

    IERC20 public immutable comd;
    address public vault;
    uint256 public streamCapPerDay;
    uint256 public streamWindow;
    uint256 public catchUpSeconds;
    uint256 public lastDrip;
    uint256 public totalDripped;

    event RewardNotified(address indexed from, uint256 amount);
    event Dripped(address indexed vault, uint256 amount);
    event VaultSet(address vault);
    event StreamParamsSet(uint256 streamCapPerDay, uint256 streamWindow, uint256 catchUpSeconds);

    error ZeroAddress();
    error OutOfBounds();
    error NoVault();

    constructor(IERC20 comd_, address vault_, address initialOwner) Ownable(initialOwner) {
        if (address(comd_) == address(0)) revert ZeroAddress();
        comd = comd_;
        vault = vault_;
        streamCapPerDay = 8_640_000e18; // 100 COMD / second (IMD's 1/s scaled to the 1B supply)
        streamWindow = 30 days;
        catchUpSeconds = 1 hours;
        lastDrip = block.timestamp;
    }

    /// @notice Pull `amount` COMD from the caller into the stream. Anyone may notify.
    function notifyReward(uint256 amount) external {
        _drip();
        comd.safeTransferFrom(msg.sender, address(this), amount);
        emit RewardNotified(msg.sender, amount);
    }

    /// @notice Permissionless: push the accrued stream into the vault.
    function drip() external returns (uint256) {
        return _drip();
    }

    function _drip() internal returns (uint256 amount) {
        amount = pending();
        lastDrip = block.timestamp;
        if (amount == 0 || vault == address(0)) return 0;
        totalDripped += amount;
        comd.safeTransfer(vault, amount);
        emit Dripped(vault, amount);
    }

    /// @notice Current stream rate (COMD wei per second).
    function ratePerSecond() public view returns (uint256) {
        uint256 bal = comd.balanceOf(address(this));
        uint256 perDay = (bal * 1 days) / streamWindow;
        if (perDay > streamCapPerDay) perDay = streamCapPerDay;
        return perDay / 1 days;
    }

    /// @notice Amount the next `drip()` would release.
    function pending() public view returns (uint256 amount) {
        if (vault == address(0) || _vaultEmpty()) return 0;
        uint256 elapsed = block.timestamp - lastDrip;
        if (elapsed > catchUpSeconds) elapsed = catchUpSeconds;
        amount = ratePerSecond() * elapsed;
        uint256 bal = comd.balanceOf(address(this));
        if (amount > bal) amount = bal;
    }

    /// @dev True when the vault has no shares. Streaming into an empty ERC-4626 with virtual shares would
    ///      hand the assets to the virtual shares forever (security review L-01); the rewards wait here instead.
    ///      A vault without `totalSupply()` (or reverting) is treated as non-empty.
    function _vaultEmpty() internal view returns (bool) {
        (bool ok, bytes memory r) = vault.staticcall(abi.encodeWithSelector(IERC20.totalSupply.selector));
        return ok && r.length >= 32 && abi.decode(r, (uint256)) == 0;
    }

    // ------------------------------------------------------------------- owner

    function setVault(address vault_) external onlyOwner {
        if (vault_ == address(0)) revert ZeroAddress();
        _drip();
        vault = vault_;
        emit VaultSet(vault_);
    }

    function setStreamParams(uint256 capPerDay, uint256 window, uint256 catchUp) external onlyOwner {
        if (capPerDay == 0 || capPerDay > MAX_STREAM_CAP_PER_DAY) revert OutOfBounds();
        if (window < MIN_WINDOW || window > MAX_WINDOW) revert OutOfBounds();
        if (catchUp == 0 || catchUp > MAX_CATCH_UP) revert OutOfBounds();
        _drip();
        streamCapPerDay = capPerDay;
        streamWindow = window;
        catchUpSeconds = catchUp;
        emit StreamParamsSet(capPerDay, window, catchUp);
    }

    function renounceOwnership() public override onlyOwner {
        if (vault == address(0)) revert NoVault();
        super.renounceOwnership();
    }
}
