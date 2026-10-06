// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {OracleAttestationVerifier} from "./OracleAttestationVerifier.sol";

/// @title OracleConsumerExample — stores answers signed by a trusted attester
/// @notice UNAUDITED — example only.
/// @notice Anyone may submit an attestation; it is accepted once per requestId if signed by `attester`
///         and not expired. The owner can rotate the attester (`setAttester`, V7 hot-key rotation); rulings already
///         accepted stay.
contract OracleConsumerExample is Ownable2Step {
    using OracleAttestationVerifier for OracleAttestationVerifier.OracleAttestation;

    address public attester;

    event AttesterSet(address attester);

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
    error ZeroAddress();

    constructor(address attester_, address owner_) Ownable(owner_) {
        if (attester_ == address(0)) revert ZeroAddress();
        attester = attester_;
        emit AttesterSet(attester_);
    }

    /// @notice Rotate the trusted signer (e.g. after a leaked ATTESTER_PRIVATE_KEY).
    function setAttester(address a) external onlyOwner {
        if (a == address(0)) revert ZeroAddress();
        attester = a;
        emit AttesterSet(a);
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
