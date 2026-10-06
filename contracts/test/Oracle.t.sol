// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {OracleAttestationVerifier} from "../src/oracle/OracleAttestationVerifier.sol";
import {OracleConsumerExample} from "../src/oracle/OracleConsumerExample.sol";

contract OracleTest is Test {
    uint256 attesterPk = 0xA77E57;
    address attester;
    OracleConsumerExample consumer;

    function setUp() public {
        attester = vm.addr(attesterPk);
        consumer = new OracleConsumerExample(attester, address(this));
        vm.warp(1_800_000_000);
    }

    function _att() internal view returns (OracleAttestationVerifier.OracleAttestation memory a) {
        a.requestId = keccak256("req-1");
        a.chainId = 1;
        a.questionHash = keccak256("Did X happen?");
        a.answerType = "bool";
        a.answer = abi.encode(true);
        a.figure = 0;
        a.fromBlock = 100;
        a.toBlock = 200;
        a.blockHash = keccak256("bh");
        a.panelJobId = keccak256("job");
        a.issuedAt = uint64(block.timestamp - 10);
        a.expiresAt = uint64(block.timestamp + 1 days);
    }

    function _sign(OracleAttestationVerifier.OracleAttestation memory a, uint256 pk) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, consumer.digest(a));
        return abi.encodePacked(r, s, v);
    }

    /// @dev Independent EIP-712 encoding (as viem/ethers would do) must match the library.
    function test_digestMatchesManualEip712() public view {
        OracleAttestationVerifier.OracleAttestation memory a = _att();
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId)"),
                keccak256("Company.md Oracle"),
                keccak256("1"),
                block.chainid
            )
        );
        bytes32 typeHash = keccak256(
            "OracleAttestation(bytes32 requestId,uint256 chainId,bytes32 questionHash,string answerType,bytes answer,uint256 figure,uint256 fromBlock,uint256 toBlock,bytes32 blockHash,bytes32 panelJobId,uint64 issuedAt,uint64 expiresAt)"
        );
        bytes32 structHash = keccak256(
            bytes.concat(
                abi.encode(typeHash, a.requestId, a.chainId, a.questionHash, keccak256(bytes(a.answerType)), keccak256(a.answer)),
                abi.encode(a.figure, a.fromBlock, a.toBlock, a.blockHash, a.panelJobId, a.issuedAt, a.expiresAt)
            )
        );
        assertEq(consumer.digest(a), keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
    }

    function test_acceptValid() public {
        OracleAttestationVerifier.OracleAttestation memory a = _att();
        bytes memory sig = _sign(a, attesterPk);
        consumer.submit(a, sig);
        assertTrue(consumer.boolAnswer(a.requestId));
        vm.expectRevert(OracleConsumerExample.AlreadyAccepted.selector);
        consumer.submit(a, sig);
    }

    function test_rejectWrongSignerTamperedExpired() public {
        OracleAttestationVerifier.OracleAttestation memory a = _att();
        bytes memory sig = _sign(a, 0xBAD);
        vm.expectRevert();
        consumer.submit(a, sig);

        sig = _sign(a, attesterPk);
        a.answer = abi.encode(false); // tampered
        vm.expectRevert();
        consumer.submit(a, sig);

        a = _att();
        sig = _sign(a, attesterPk);
        vm.warp(a.expiresAt + 1);
        vm.expectRevert(abi.encodeWithSelector(OracleAttestationVerifier.AttestationExpired.selector, a.expiresAt));
        consumer.submit(a, sig);
    }

    function test_domainBoundToChain() public {
        OracleAttestationVerifier.OracleAttestation memory a = _att();
        bytes memory sig = _sign(a, attesterPk);
        vm.chainId(4663);
        vm.expectRevert();
        consumer.submit(a, sig);
    }
}
