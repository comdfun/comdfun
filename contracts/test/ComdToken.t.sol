// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ComdToken} from "../src/ComdToken.sol";

contract ComdTokenTest is Test {
    ComdToken t;
    uint256 ownerPk = 0xA11CE;
    address owner;

    function setUp() public {
        owner = vm.addr(ownerPk);
        t = new ComdToken(owner);
    }

    function test_metadataAndSupply() public view {
        assertEq(t.name(), "Company.md");
        assertEq(t.symbol(), "COMD");
        assertEq(t.decimals(), 18);
        assertEq(t.totalSupply(), 1_000_000_000e18);
        assertEq(t.TOTAL_SUPPLY(), 1_000_000_000e18);
        assertEq(t.balanceOf(owner), 1_000_000_000e18, "100% to the POL wallet");
    }

    function test_zeroRecipient() public {
        vm.expectRevert(ComdToken.ZeroRecipient.selector);
        new ComdToken(address(0));
    }

    function test_noMintNoTransferTax() public {
        (bool ok,) = address(t).call(abi.encodeWithSignature("mint(address,uint256)", address(this), 1));
        assertFalse(ok);
        vm.prank(owner);
        t.transfer(address(this), 1_000e18);
        assertEq(t.balanceOf(address(this)), 1_000e18, "wallet transfers are untaxed");
    }

    function testFuzz_burn(uint256 amt) public {
        amt = bound(amt, 0, 1_000_000_000e18);
        vm.prank(owner);
        t.burn(amt);
        assertEq(t.totalSupply(), 1_000_000_000e18 - amt);
    }

    function test_permit() public {
        address spender = makeAddr("spender");
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner,
                spender,
                1e18,
                t.nonces(owner),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", t.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, digest);
        t.permit(owner, spender, 1e18, deadline, v, r, s);
        assertEq(t.allowance(owner, spender), 1e18);
    }
}
