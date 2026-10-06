// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Builds OpenZeppelin-compatible Merkle trees (sorted-pair hashing) in Solidity for tests.
///         Odd nodes are promoted unchanged to the next level (no sibling => no proof element).
abstract contract MerkleHelper {
    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function _root(bytes32[] memory leaves) internal pure returns (bytes32) {
        require(leaves.length > 0, "empty");
        bytes32[] memory level = leaves;
        while (level.length > 1) {
            bytes32[] memory next = new bytes32[]((level.length + 1) / 2);
            for (uint256 i; i < next.length; ++i) {
                uint256 l = 2 * i;
                next[i] = l + 1 < level.length ? _hashPair(level[l], level[l + 1]) : level[l];
            }
            level = next;
        }
        return level[0];
    }

    function _proof(bytes32[] memory leaves, uint256 index) internal pure returns (bytes32[] memory proof) {
        bytes32[] memory tmp = new bytes32[](256);
        uint256 n;
        bytes32[] memory level = leaves;
        uint256 idx = index;
        while (level.length > 1) {
            uint256 sib = idx ^ 1;
            if (sib < level.length) tmp[n++] = level[sib];
            bytes32[] memory next = new bytes32[]((level.length + 1) / 2);
            for (uint256 i; i < next.length; ++i) {
                uint256 l = 2 * i;
                next[i] = l + 1 < level.length ? _hashPair(level[l], level[l + 1]) : level[l];
            }
            level = next;
            idx /= 2;
        }
        proof = new bytes32[](n);
        for (uint256 i; i < n; ++i) proof[i] = tmp[i];
    }

    function _seatLeaf(uint256 epoch, uint256 tokenId, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(epoch, tokenId, amount))));
    }

    function _contribLeaf(uint256 launchId, address account, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(launchId, account, amount))));
    }

    function _allowLeaf(address account) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account))));
    }
}
