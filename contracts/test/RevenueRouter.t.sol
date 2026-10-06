// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RevenueRouter} from "../src/RevenueRouter.sol";
import {MockComd} from "../src/mocks/MockComd.sol";

contract RevenueRouterTest is Test {
    MockComd comd;
    RevenueRouter rr;
    address admin = makeAddr("admin");
    address rewards = makeAddr("rewardDistributor");
    address treasury = makeAddr("treasury");

    function setUp() public {
        comd = new MockComd();
        rr = new RevenueRouter(IERC20(address(comd)), rewards, treasury, admin);
    }

    function test_defaults() public view {
        (uint16 r, uint16 t) = rr.bps();
        assertEq(r, 8_000);
        assertEq(t, 2_000);
        assertEq(rr.rewardDistributor(), rewards);
        assertEq(rr.treasury(), treasury);
        assertEq(address(rr.comd()), address(comd));
    }

    function test_distribute80to20() public {
        comd.transfer(address(rr), 5e18 + 1); // one x402 job payment in COMD + 1 wei
        vm.expectEmit(false, false, false, true, address(rr));
        emit RevenueRouter.Distributed(5e18 + 1, 4e18, 1e18 + 1);
        (uint256 toR, uint256 toT) = rr.distribute(); // anyone
        assertEq(toR, 4e18);
        assertEq(toT, 1e18 + 1);
        assertEq(comd.balanceOf(rewards), 4e18);
        assertEq(comd.balanceOf(treasury), 1e18 + 1);
        assertEq(comd.balanceOf(address(rr)), 0);
        vm.expectRevert(RevenueRouter.NothingToDistribute.selector);
        rr.distribute();
    }

    function test_ownerBoundsAndTreasury() public {
        vm.prank(makeAddr("x"));
        vm.expectRevert();
        rr.setBps(9_000);
        vm.startPrank(admin);
        vm.expectRevert(RevenueRouter.BadBps.selector);
        rr.setBps(4_999);
        vm.expectRevert(RevenueRouter.BadBps.selector);
        rr.setBps(10_001);
        rr.setBps(10_000);
        vm.expectRevert(RevenueRouter.ZeroAddress.selector);
        rr.setTreasury(address(0));
        rr.setTreasury(makeAddr("t2"));
        vm.stopPrank();
        comd.transfer(address(rr), 10e18);
        rr.distribute();
        assertEq(comd.balanceOf(rewards), 10e18);
    }

    function testFuzz_splitExact(uint256 amt, uint16 b) public {
        amt = bound(amt, 1, 1e27);
        b = uint16(bound(b, 5_000, 10_000));
        vm.prank(admin);
        rr.setBps(b);
        comd.transfer(address(rr), amt);
        rr.distribute();
        assertEq(comd.balanceOf(rewards) + comd.balanceOf(treasury), amt);
        assertEq(comd.balanceOf(rewards), amt * b / 10_000);
    }
}
