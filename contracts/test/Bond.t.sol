// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ComdToken} from "../src/ComdToken.sol";
import {Bond} from "../src/Bond.sol";

contract RejectEth {
    receive() external payable {
        revert("no");
    }
}

contract BondTest is Test {
    ComdToken comd;
    Bond bond;
    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    uint256 constant PRICE = 0.004 ether; // wei per 1e18 COMD

    function setUp() public {
        comd = new ComdToken(address(this));
        bond = new Bond(IERC20(address(comd)), treasury, PRICE, admin);
        comd.transfer(address(bond), 1_000e18);
        vm.deal(alice, 100 ether);
    }

    function _enable() internal {
        vm.prank(admin);
        bond.setEnabled(true);
    }

    function test_disabledByDefault() public {
        assertFalse(bond.enabled());
        assertEq(bond.reserve(), 1_000e18);
        assertEq(bond.priceEth(), PRICE);
        assertEq(bond.treasury(), treasury);
        vm.prank(alice);
        vm.expectRevert(Bond.NotEnabled.selector);
        bond.buyWithEth{value: PRICE}(0);
    }

    function test_buyWithEth() public {
        _enable();
        vm.expectEmit(true, false, false, true, address(bond));
        emit Bond.Bonded(alice, 0.04 ether, 10e18);
        vm.prank(alice);
        uint256 out = bond.buyWithEth{value: 0.04 ether}(10e18);
        assertEq(out, 10e18);
        assertEq(comd.balanceOf(alice), 10e18);
        assertEq(treasury.balance, 0.04 ether);
        assertEq(address(bond).balance, 0);
        assertEq(bond.reserve(), 990e18);
        assertEq(bond.totalSold(), 10e18);
        assertEq(bond.totalProceeds(), 0.04 ether);
    }

    function test_slippageReserveZero() public {
        _enable();
        vm.startPrank(alice);
        vm.expectRevert(Bond.Slippage.selector);
        bond.buyWithEth{value: 0.04 ether}(11e18);
        vm.expectRevert(Bond.InsufficientReserve.selector);
        bond.buyWithEth{value: 4.004 ether}(0);
        vm.expectRevert(Bond.ZeroAmount.selector);
        bond.buyWithEth{value: 0}(0);
        vm.stopPrank();
        vm.prank(admin);
        bond.setPrice(1e30); // 1 wei buys 0
        vm.prank(alice);
        vm.expectRevert(Bond.ZeroAmount.selector);
        bond.buyWithEth{value: 1}(0);
    }

    function test_treasuryRejectingEthReverts() public {
        _enable();
        address r = address(new RejectEth());
        vm.prank(admin);
        bond.setTreasury(r);
        vm.prank(alice);
        vm.expectRevert(Bond.TransferFailed.selector);
        bond.buyWithEth{value: 0.04 ether}(0);
        assertEq(comd.balanceOf(alice), 0);
    }

    function test_owner() public {
        vm.startPrank(admin);
        vm.expectRevert(Bond.ZeroPrice.selector);
        bond.setPrice(0);
        vm.expectRevert(Bond.ZeroAddress.selector);
        bond.setTreasury(address(0));
        bond.setPrice(0.005 ether);
        bond.setTreasury(alice);
        vm.stopPrank();
        assertEq(bond.quote(0.005 ether), 1e18);
        vm.prank(alice);
        vm.expectRevert();
        bond.setEnabled(true);
        vm.prank(alice);
        vm.expectRevert();
        bond.setPrice(1);
    }

    function testFuzz_quote(uint256 ethIn, uint256 price) public {
        price = bound(price, 1, 1e24);
        ethIn = bound(ethIn, 1, 1e24);
        vm.prank(admin);
        bond.setPrice(price);
        assertEq(bond.quote(ethIn), ethIn * 1e18 / price);
    }

    function testFuzz_buyConservation(uint256 ethIn) public {
        ethIn = bound(ethIn, 1e9, 4 ether);
        _enable();
        uint256 exp = bond.quote(ethIn);
        vm.prank(alice);
        uint256 out = bond.buyWithEth{value: ethIn}(0);
        assertEq(out, exp);
        assertEq(comd.balanceOf(alice) + bond.reserve(), 1_000e18);
        assertEq(treasury.balance, ethIn);
    }
}
