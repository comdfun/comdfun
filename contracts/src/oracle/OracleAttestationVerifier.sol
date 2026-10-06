// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title OracleAttestationVerifier — EIP-712 verification of Company.md's oracle ("Rulings") attestations
/// @notice Reviewed before launch (contracts/AUDIT.md).
/// @dev Domain: EIP712Domain(string name,string version,uint256 chainId) with name "Company.md Oracle",
///      version "1", chainId = the chain where the attestation is verified (block.chainid). No
///      verifyingContract (the attester signs once for every consumer on that chain).
///      Struct:
///      OracleAttestation(bytes32 requestId,uint256 chainId,bytes32 questionHash,string answerType,bytes answer,
///        uint256 figure,uint256 fromBlock,uint256 toBlock,bytes32 blockHash,bytes32 panelJobId,uint64 issuedAt,
///        uint64 expiresAt)
///      `chainId` inside the struct is the chain the QUESTION is about; it may differ from the domain chainId.
///      Dynamic fields (string, bytes) are hashed with keccak256 per EIP-712.
library OracleAttestationVerifier {
    struct OracleAttestation {
        bytes32 requestId;
        uint256 chainId;
        bytes32 questionHash;
        string answerType;
        bytes answer;
        uint256 figure;
        uint256 fromBlock;
        uint256 toBlock;
        bytes32 blockHash;
        bytes32 panelJobId;
        uint64 issuedAt;
        uint64 expiresAt;
    }

    bytes32 internal constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId)");
    bytes32 internal constant NAME_HASH = keccak256("Company.md Oracle");
    bytes32 internal constant VERSION_HASH = keccak256("1");
    bytes32 internal constant ATTESTATION_TYPEHASH = keccak256(
        "OracleAttestation(bytes32 requestId,uint256 chainId,bytes32 questionHash,string answerType,bytes answer,uint256 figure,uint256 fromBlock,uint256 toBlock,bytes32 blockHash,bytes32 panelJobId,uint64 issuedAt,uint64 expiresAt)"
    );

    error AttestationExpired(uint64 expiresAt);
    error AttestationNotYetValid(uint64 issuedAt);
    error BadSigner(address recovered, address expected);

    function domainSeparator(uint256 chainId) internal pure returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, chainId));
    }

    function hashStruct(OracleAttestation memory a) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(
                    ATTESTATION_TYPEHASH,
                    a.requestId,
                    a.chainId,
                    a.questionHash,
                    keccak256(bytes(a.answerType)),
                    keccak256(a.answer),
                    a.figure
                ),
                abi.encode(a.fromBlock, a.toBlock, a.blockHash, a.panelJobId, a.issuedAt, a.expiresAt)
            )
        );
    }

    /// @notice EIP-712 digest for the current chain.
    function digest(OracleAttestation memory a) internal view returns (bytes32) {
        return digestFor(a, block.chainid);
    }

    function digestFor(OracleAttestation memory a, uint256 domainChainId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(domainChainId), hashStruct(a)));
    }

    function recover(OracleAttestation memory a, bytes memory signature) internal view returns (address) {
        return ECDSA.recover(digest(a), signature);
    }

    /// @notice Reverts unless `signature` is `attester`'s and the attestation is inside [issuedAt, expiresAt].
    function verify(OracleAttestation memory a, bytes memory signature, address attester) internal view {
        if (block.timestamp > a.expiresAt) revert AttestationExpired(a.expiresAt);
        if (block.timestamp < a.issuedAt) revert AttestationNotYetValid(a.issuedAt);
        address signer = recover(a, signature);
        if (signer != attester) revert BadSigner(signer, attester);
    }
}
