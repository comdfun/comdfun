// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {OracleAttestationVerifier} from "./OracleAttestationVerifier.sol";

/// @title OracleConsumerExample — stores answers signed by a trusted attester
/// @notice UNAUDITED — example only.
/// @notice Anyone may submit an attestation; it is accepted once per requestId if signed by `attester`
///         and not expired.
contract OracleConsumerExample {
    using OracleAttestationVerifier for OracleAttestationVerifier.OracleAttestation;

    address public immutable attester;

    struct Ruling {
        string answerType;
        bytes answer;
        uint256 figure;
        uint64 expiresAt;
        bool set;
    }

    mapping(bytes32 => Ruling) public rulings;

    event RulingAccepted(bytes32 indexed requestId, bytes32 questionHash, string answerType, bytes answer, uint256 figure);

    error AlreadyAccepted();

    constructor(address attester_) {
        attester = attester_;
    }

    function submit(OracleAttestationVerifier.OracleAttestation calldata a, bytes calldata signature) external {
        if (rulings[a.requestId].set) revert AlreadyAccepted();
        OracleAttestationVerifier.verify(a, signature, attester);
        rulings[a.requestId] = Ruling(a.answerType, a.answer, a.figure, a.expiresAt, true);
        emit RulingAccepted(a.requestId, a.questionHash, a.answerType, a.answer, a.figure);
    }

    /// @notice Convenience: decode a bool answer.
    function boolAnswer(bytes32 requestId) external view returns (bool) {
        return abi.decode(rulings[requestId].answer, (bool));
    }

    function digest(OracleAttestationVerifier.OracleAttestation calldata a) external view returns (bytes32) {
        return OracleAttestationVerifier.digest(a);
    }
}
