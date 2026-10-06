// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockComd — stand-in for the Pons-minted $COMD on test chains
/// @notice TESTNET / TESTS ONLY. Plain ERC-20, 18 decimals, 1,000,000,000 minted once to the deployer.
///         Deliberately has NO `burn()`: the real token comes from Pons and may not have one either, so every
///         "burn" in the system is a transfer to the dead address (0x…dEaD) and the tests prove that path works.
contract MockComd is ERC20 {
    uint256 public constant SUPPLY = 1_000_000_000e18;

    constructor() ERC20("Company.md", "COMD") {
        _mint(msg.sender, SUPPLY);
    }
}
