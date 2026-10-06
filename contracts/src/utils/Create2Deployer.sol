// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

/// @title Create2Deployer — permissionless CREATE2 deployer for v4 hooks (mined addresses)
/// @notice Reviewed before launch (contracts/AUDIT.md). Used by the deploy script so hook addresses (whose low 14 bits encode
///         their permissions) can be mined without relying on a pre-deployed deterministic deployer.
///         Front-running a deployment is harmless: the address commits to the full init code (incl. args).
contract Create2Deployer {
    event Deployed(address indexed addr, bytes32 salt);

    function deploy(bytes32 salt, bytes calldata initCode) external returns (address addr) {
        addr = Create2.deploy(0, salt, initCode);
        emit Deployed(addr, salt);
    }

    function computeAddress(bytes32 salt, bytes32 initCodeHash) external view returns (address) {
        return Create2.computeAddress(salt, initCodeHash);
    }
}
