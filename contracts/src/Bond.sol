// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Bond — sells the bonding reserve for ETH
/// @notice UNAUDITED — experimental. Do not use with funds you cannot afford to lose.
/// @notice The reserve is the COMD this contract holds: 6% of every ComdTaxHook trim (COMD the market already
///         captured). Once the owner sets `enabled`, anyone can buy reserve COMD with ETH at the fixed `priceEth`
///         (wei per 1 COMD = 1e18 wei). ETH proceeds go straight to the firm treasury (compute + gas).
/// @notice Inspired by IMD (imd.fun), whose bond opens at a set price "after the price is reached"; here the owner (or
///         its keeper) checks the market price off-chain and flips `enabled`. There is no on-chain oracle.
/// @notice Owner powers (vanish on renounce): enable/disable, set price (> 0 — no lower bound: the owner could price the
///         reserve near zero and buy it, security review L-05), set treasury. No direct withdrawal of the reserve.
contract Bond is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable comd;
    address public treasury;
    uint256 public priceEth;
    bool public enabled;
    uint256 public totalSold;
    uint256 public totalProceeds;

    event Bonded(address indexed buyer, uint256 ethIn, uint256 comdOut);
    event EnabledSet(bool enabled);
    event PriceSet(uint256 priceEth);
    event TreasurySet(address treasury);

    error ZeroAddress();
    error NotEnabled();
    error ZeroPrice();
    error InsufficientReserve();
    error Slippage();
    error ZeroAmount();
    error TransferFailed();

    constructor(IERC20 comd_, address treasury_, uint256 priceEth_, address initialOwner) Ownable(initialOwner) {
        if (address(comd_) == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (priceEth_ == 0) revert ZeroPrice();
        comd = comd_;
        treasury = treasury_;
        priceEth = priceEth_;
    }

    /// @notice COMD available for bonding.
    function reserve() public view returns (uint256) {
        return comd.balanceOf(address(this));
    }

    /// @notice COMD out for `ethIn` wei at the current price (rounded down).
    function quote(uint256 ethIn) public view returns (uint256) {
        return (ethIn * 1e18) / priceEth;
    }

    function buyWithEth(uint256 minOut) external payable nonReentrant returns (uint256 out) {
        if (!enabled) revert NotEnabled();
        if (msg.value == 0) revert ZeroAmount();
        out = quote(msg.value);
        if (out == 0) revert ZeroAmount();
        if (out < minOut) revert Slippage();
        if (out > reserve()) revert InsufficientReserve();
        totalSold += out;
        totalProceeds += msg.value;
        comd.safeTransfer(msg.sender, out);
        (bool ok,) = treasury.call{value: msg.value}("");
        if (!ok) revert TransferFailed();
        emit Bonded(msg.sender, msg.value, out);
    }

    function setEnabled(bool on) external onlyOwner {
        enabled = on;
        emit EnabledSet(on);
    }

    function setPrice(uint256 newPrice) external onlyOwner {
        if (newPrice == 0) revert ZeroPrice();
        priceEth = newPrice;
        emit PriceSet(newPrice);
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasurySet(t);
    }
}
