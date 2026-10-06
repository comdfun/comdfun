// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./utils/Base.sol";
import {BuyWall} from "../src/BuyWall.sol";
import {ComdTaxHook} from "../src/ComdTaxHook.sol";
import {TickAlign} from "../src/libraries/TickAlign.sol";

/// @notice The protocol's buy wall on the official pool: post, fill, rebalance, tips, parking, floor bounds.
contract BuyWallTest is Base {
    function setUp() public {
        setUpSystem();
        initSeedAndTrade(); // pool holds ETH; price below the opening tick
    }

    function _fund(uint256 eth) internal {
        vm.deal(address(wall), address(wall).balance + eth); // stands in for trim proceeds
    }

    function test_rebalanceRequiresWork() public {
        assertFalse(wall.canRebalance());
        vm.expectRevert(BuyWall.NothingToRebalance.selector);
        wall.rebalance();
    }

    function test_onlyPoolManagerPaysEth() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(wall).call{value: 1}("");
        assertFalse(ok);
        vm.expectRevert(BuyWall.NotPoolManager.selector);
        wall.unlockCallback("");
    }

    function test_trimEthReachesWallAndPostsAboveTick() public {
        _fastDecay();
        // a real trim: buy (opens room), let the cap decay, sell back
        _forceTrim(alice, 5 ether, 2_000); // the 20 ETH market buy opened ~655M of room
        ComdTaxHook.Stats memory st = hook.stats();
        assertGt(st.trimmedEth, 0.1 ether);
        assertEq(address(wall).balance + hook.claimEth(), st.trimmedEth);
        assertTrue(wall.canRebalance());
        uint256 eth = address(wall).balance + hook.claimEth();
        uint256 k0 = keeper.balance;
        vm.prank(keeper);
        uint256 tip = wall.rebalance();
        assertEq(keeper.balance - k0, tip);
        assertLe(tip, 0.002 ether);
        assertLe(tip, eth / 100);
        assertGt(wall.wallLiquidity(), 0);
        assertGt(wall.wallLower(), _tick(), "ETH-only bid above the tick (below the price)");
        assertEq(wall.wallLower() % 200, 0);
        assertEq(wall.wallUpper() - wall.wallLower(), 4_000);
        assertLe(address(wall).balance, 10, "all ETH posted");
        vm.expectRevert(BuyWall.NothingToRebalance.selector);
        wall.rebalance(); // nothing new: no tip farming
        _assertTaxConservation();
        _assertSplitConservation();
    }

    function test_wallFillRoutesBoughtComdThroughSplit() public {
        _fund(2 ether);
        vm.roll(block.number + 1);
        wall.rebalance();
        uint256 posted = wall.wallEthPosted();
        // a large sell drives the price into the wall
        _sell(bob, 900_000_000e18);
        (uint256 wEth, uint256 wComd) = wall.wallAmounts(_sqrtP());
        assertGt(wComd, 10_000e18, "wall filled");
        assertLt(wEth, posted);
        uint256 split0 = hook.stats().split;
        uint256 supply0 = comd.totalSupply();
        vm.roll(block.number + 1);
        vm.prank(keeper);
        uint256 tip = wall.rebalance();
        assertApproxEqAbs(wall.totalWallBought(), wComd, 1e9);
        assertEq(hook.stats().split - split0, wall.totalWallBought());
        assertGe(supply0 - comd.totalSupply(), wall.totalWallBought() * 85 / 100 - 1, "85% of the fill burned");
        assertLe(tip, 0.002 ether);
        assertEq(comd.balanceOf(address(wall)), 0);
        _assertSplitConservation();
    }

    function test_parkedWhenPriceBelowFloor() public {
        _fund(1 ether);
        wall.rebalance();
        // crash through the whole wall in one block
        _sell(bob, 950_000_000e18);
        assertGt(_tick(), wall.wallUpper());
        vm.roll(block.number + 1);
        _fund(0.5 ether); // fresh trim ETH arrives after the crash
        wall.rebalance(); // closes the filled wall; the floor cannot follow the crash at once
        assertEq(wall.wallLiquidity(), 0, "parked");
        assertGt(wall.parkedEth(), 0);
        int24 f0 = wall.floorTick();
        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 100_000);
        hook.observe();
        assertLe(wall.previewFloorTick() - f0, 400, "~4%/day away from the price, never more");
    }

    /// H-01 regression (also in security/Findings): a reference pumped for a few blocks cannot drag the floor
    /// toward the price by more than one day's allowance.
    function test_floorTowardPriceBounded() public {
        _fund(1 ether);
        wall.rebalance();
        int24 f0 = wall.floorTick();
        _buy(alice, 10 ether); // pump
        for (uint256 i; i < 20; ++i) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 12);
            hook.observe();
        }
        _fund(0.2 ether);
        wall.rebalance();
        assertGe(wall.floorTick(), f0 - 400, "moved toward the pumped price by at most 400 ticks");
    }

    function testFuzz_tipBounds(uint256 eth) public {
        eth = bound(eth, 0.1 ether, 50 ether);
        _fund(eth);
        uint256 k0 = keeper.balance;
        vm.prank(keeper);
        uint256 tip = wall.rebalance();
        assertEq(keeper.balance - k0, tip);
        assertLe(tip, 0.002 ether);
        assertLe(tip, eth / 100);
    }

    function test_setParamsBounds() public {
        BuyWall.Params memory p = wall.params();
        vm.expectRevert();
        wall.setParams(p);
        vm.startPrank(admin);
        p.tipCap = 0.003 ether;
        vm.expectRevert(BuyWall.BadParams.selector);
        wall.setParams(p);
        p = wall.params();
        p.tipBps = 101;
        vm.expectRevert(BuyWall.BadParams.selector);
        wall.setParams(p);
        p = wall.params();
        p.floorDecayTicksPerDay = 0;
        vm.expectRevert(BuyWall.BadParams.selector);
        wall.setParams(p);
        p = wall.params();
        p.wallWidthTicks = 100;
        vm.expectRevert(BuyWall.BadParams.selector);
        wall.setParams(p);
        p = wall.params();
        p.wallWidthTicks = 2_000;
        wall.setParams(p);
        vm.stopPrank();
        assertEq(wall.params().wallWidthTicks, 2_000);
    }
}
