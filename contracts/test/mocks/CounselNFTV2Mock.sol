// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CounselNFT} from "../../src/CounselNFT.sol";

/// @notice A V2 implementation for upgrade tests: keeps every V1 function and storage namespace, adds a new
///         namespaced field (`motto`) and a `version()`; proves holders, phase, price, baseURI and owner survive.
contract CounselNFTV2Mock is CounselNFT {
    /// @custom:storage-location erc7201:comd.storage.CounselNFTV2
    struct V2Storage {
        string motto;
    }

    // keccak256(abi.encode(uint256(keccak256("comd.storage.CounselNFTV2")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant V2_LOCATION = 0x5a1d1a2a9a9c1b4d0d2f6e0c8b7a6d5c4b3a29181716151413121110a0b0c000;

    function _v2() private pure returns (V2Storage storage $) {
        assembly {
            $.slot := V2_LOCATION
        }
    }

    function version() external pure returns (uint256) {
        return 2;
    }

    function setMotto(string calldata m) external onlyOwner {
        _v2().motto = m;
    }

    function motto() external view returns (string memory) {
        return _v2().motto;
    }
}
