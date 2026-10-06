// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// UNAUDITED — experimental.
// Compiles the vendored CC0 ERC-8004 registries (github.com/erc-8004/erc-8004-contracts, v2.0.0) into out/ so
// the deploy script (vm.getCode) and the ABI package can use them. They need via-IR, which foundry.toml
// restricts to these two files; nothing else imports them, so the rest of the code base compiles without via-IR.
import {IdentityRegistryUpgradeable} from "erc-8004/IdentityRegistryUpgradeable.sol";
import {ReputationRegistryUpgradeable} from "erc-8004/ReputationRegistryUpgradeable.sol";
