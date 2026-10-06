// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC8004Identity, IERC8004Reputation} from "../../src/interfaces/IERC8004.sol";
import {ERC8004Bootstrap} from "../../src/ERC8004Bootstrap.sol";

/// @notice Deploys the vendored CC0 ERC-8004 registries behind ERC-1967 proxies, the same way Deploy.s.sol does.
abstract contract ERC8004Fixture is Test {
    function deployErc8004(address owner) internal returns (IERC8004Identity identity, IERC8004Reputation reputation) {
        address boot = address(new ERC8004Bootstrap());
        bytes memory init = abi.encodeCall(ERC8004Bootstrap.initialize, (address(this)));
        identity = IERC8004Identity(address(new ERC1967Proxy(boot, init)));
        reputation = IERC8004Reputation(address(new ERC1967Proxy(boot, init)));
        identity.upgradeToAndCall(
            deployCode("IdentityRegistryUpgradeable.sol:IdentityRegistryUpgradeable"),
            abi.encodeCall(IERC8004Identity.initialize, ())
        );
        IERC8004Identity(address(reputation)).upgradeToAndCall(
            deployCode("ReputationRegistryUpgradeable.sol:ReputationRegistryUpgradeable"),
            abi.encodeCall(IERC8004Reputation.initialize, (address(identity)))
        );
        if (owner != address(this)) {
            identity.transferOwnership(owner);
            reputation.transferOwnership(owner);
        }
    }
}
