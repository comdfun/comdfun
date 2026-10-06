// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title ERC8004Bootstrap — first implementation behind the ERC-8004 registry proxies
/// @notice Reviewed before launch (contracts/AUDIT.md).
/// @notice The vendored CC0 registries (erc-8004-contracts v2) are UUPS implementations whose
///         `initialize()` is `reinitializer(2) onlyOwner`: they expect a proxy that already has an owner
///         (upstream uses a MinimalUUPS placeholder with a hard-coded owner). This bootstrap plays that role
///         for our own deployment: proxy(bootstrap, initialize(owner)) → owner calls
///         upgradeToAndCall(registryImpl, registry.initialize(...)). No storage of its own (ERC-7201 only).
contract ERC8004Bootstrap is OwnableUpgradeable, UUPSUpgradeable {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        __Ownable_init(owner_);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
