// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title ComdToken ($COMD) — Company.md
/// @notice UNAUDITED — experimental. Do not use with funds you cannot afford to lose.
/// @notice Fixed-supply ERC-20 of Company.md. 1,000,000,000 COMD are minted exactly once, in the constructor,
///         to one recipient (the POL wallet), which puts 100% of it into the single-sided COMD/ETH v4 position.
///         No mint function, no owner, no transfer tax (the 5% tax lives in the official pool's hook only,
///         so wallet transfers and Permit2 payments are untaxed). Holders can burn and sign permits.
contract ComdToken is ERC20, ERC20Burnable, ERC20Permit {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;

    error ZeroRecipient();

    constructor(address recipient) ERC20("Company.md", "COMD") ERC20Permit("Company.md") {
        if (recipient == address(0)) revert ZeroRecipient();
        _mint(recipient, TOTAL_SUPPLY);
    }
}
