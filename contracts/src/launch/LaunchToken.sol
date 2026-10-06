// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title LaunchToken — fixed-supply ERC-20 template for swarm launches and Incorporations coins
/// @notice Reviewed before launch: an internal security review plus an independent security review (contracts/AUDIT.md).
/// @notice The whole supply is minted once to `recipient` (the factory / launchpad). No owner, no mint.
contract LaunchToken is ERC20, ERC20Burnable, ERC20Permit {
    constructor(string memory name_, string memory symbol_, uint256 supply_, address recipient)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        _mint(recipient, supply_);
    }
}
