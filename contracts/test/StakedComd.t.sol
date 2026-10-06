// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ComdToken} from "../src/ComdToken.sol";
import {StakedComd} from "../src/StakedComd.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {RewardDripper} from "../src/RewardDripper.sol";
import {MockERC20} from "./mocks/Mocks.sol";

contract StakedComdTest is Test {
    ComdToken comd;
    StakedComd vault;
    RewardDripper dripper;
    address admin = makeAddr("admin");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        comd = new ComdToken(address(this));
        vault = new StakedComd(IERC20(address(comd)), admin);
        dripper = new RewardDripper(IERC20(address(comd)), address(vault), admin);
        comd.transfer(alice, 1_000_000e18);
        comd.transfer(bob, 1_000_000e18);
        vm.prank(alice);
        comd.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        comd.approve(address(vault), type(uint256).max);
    }

    function _dep(address who, uint256 amt) internal returns (uint256 s) {
        vm.prank(who);
        s = vault.deposit(amt, who);
    }

    function test_metadata() public view {
        assertEq(vault.name(), "Staked COMD");
        assertEq(vault.symbol(), "sCOMD");
        assertEq(vault.decimals(), 24);
        assertEq(vault.asset(), address(comd));
    }

    function test_depositRedeemRoundTrip() public {
        uint256 s = _dep(alice, 1_000e18);
        assertEq(vault.previewDeposit(1_000e18), s);
        assertEq(vault.totalAssets(), 1_000e18);
        vm.roll(block.number + 1);
        vm.prank(alice);
        uint256 out = vault.redeem(s, alice, alice);
        assertEq(out, 1_000e18);
    }

    function test_sameBlockHold() public {
        uint256 s = _dep(alice, 1_000e18);
        vm.startPrank(alice);
        // redeem: the ERC-4626 max check sees the held shares (maxRedeem = 0 this block)
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxRedeem.selector, alice, s, 0));
        vault.redeem(s, alice, alice);
        vm.expectRevert(StakedComd.SameBlockHold.selector);
        vault.transfer(bob, s);
        vm.stopPrank();
        vm.roll(block.number + 1);
        vm.prank(alice);
        vault.transfer(bob, s / 2);
        vm.prank(bob);
        vault.redeem(s / 2, bob, bob); // receiving by transfer does not start a hold
    }

    function test_dripRaisesShareValue() public {
        uint256 s = _dep(alice, 1_000e18);
        comd.transfer(address(dripper), 10_000e18);
        vm.warp(block.timestamp + 1 hours);
        uint256 p = dripper.pending();
        assertGt(p, 0);
        dripper.drip();
        assertEq(vault.totalAssets(), 1_000e18 + p);
        assertApproxEqAbs(vault.convertToAssets(s), 1_000e18 + p, 1e6);
    }

    function test_pauseAndRenounce() public {
        vm.prank(admin);
        vault.pause();
        vm.prank(alice);
        vm.expectRevert();
        vault.deposit(1e18, alice);
        vm.prank(admin);
        vm.expectRevert(StakedComd.RenounceWhilePaused.selector);
        vault.renounceOwnership();
        vm.prank(admin);
        vault.unpause();
        vm.prank(admin);
        vault.renounceOwnership();
        assertEq(vault.owner(), address(0));
    }

    function test_sweepCannotTakeAsset() public {
        _dep(alice, 1_000e18);
        vm.prank(admin);
        vm.expectRevert(StakedComd.CannotSweepAsset.selector);
        vault.sweep(IERC20(address(comd)), admin, 1);
        MockERC20 u = new MockERC20("Other", "OTH");
        u.mint(address(vault), 5e6);
        vm.prank(admin);
        vault.sweep(IERC20(address(u)), admin, 5e6);
        assertEq(u.balanceOf(admin), 5e6);
    }

    function testFuzz_inflationAttackResisted(uint256 donation, uint256 victim) public {
        donation = bound(donation, 1e18, 900_000e18);
        victim = bound(victim, 1e18, 900_000e18);
        _dep(bob, 1);
        vm.prank(bob);
        comd.transfer(address(vault), donation);
        uint256 s = _dep(alice, victim);
        assertGt(s, 0);
        vm.roll(block.number + 1);
        vm.prank(alice);
        uint256 back = vault.redeem(s, alice, alice);
        uint256 victimLoss = victim > back ? victim - back : 0;
        // virtual offset 1e6: the victim's loss is bounded by ~donation/1e6 and the attacker never profits
        assertLe(victimLoss, donation / 1e5 + 1);
        uint256 bobShares = vault.balanceOf(bob);
        vm.prank(bob);
        uint256 attackerBack = vault.redeem(bobShares, bob, bob);
        assertLe(attackerBack, donation + 1, "attacker cannot profit");
    }

    function test_dripperRateAndCap() public {
        _dep(alice, 1e18); // a staker exists (nothing streams into an empty vault — review L-01)
        assertEq(dripper.ratePerSecond(), 0);
        comd.transfer(address(dripper), 300_000_000e18);
        assertEq(dripper.ratePerSecond(), 100e18); // 10M/day > cap 8.64M/day
        assertEq(dripper.streamCapPerDay(), 8_640_000e18);
        vm.warp(block.timestamp + 10 minutes);
        assertEq(dripper.pending(), 60_000e18);
        vm.warp(block.timestamp + 10 days);
        assertEq(dripper.pending(), 360_000e18); // 1 h catch-up buffer
        dripper.drip();
        assertEq(comd.balanceOf(address(vault)), 1e18 + 360_000e18);
        assertEq(dripper.totalDripped(), 360_000e18);
        assertEq(dripper.pending(), 0);
    }

    function test_dripperLinearUnderCap() public {
        _dep(alice, 1e18);
        comd.transfer(address(dripper), 30_000e18);
        assertEq(dripper.ratePerSecond(), uint256(1_000e18) / 1 days);
        vm.warp(block.timestamp + 1 hours);
        assertEq(dripper.pending(), (uint256(1_000e18) / 1 days) * 3600);
    }

    function test_notifyRewardPulls() public {
        comd.approve(address(dripper), 100e18);
        dripper.notifyReward(100e18);
        assertEq(comd.balanceOf(address(dripper)), 100e18);
    }

    function test_dripperOwner() public {
        vm.startPrank(admin);
        vm.expectRevert(RewardDripper.OutOfBounds.selector);
        dripper.setStreamParams(0, 30 days, 1 hours);
        vm.expectRevert(RewardDripper.OutOfBounds.selector);
        dripper.setStreamParams(1e18, 1 hours, 1 hours);
        vm.expectRevert(RewardDripper.OutOfBounds.selector);
        dripper.setStreamParams(1e18, 30 days, 2 days);
        dripper.setStreamParams(1_000e18, 7 days, 2 hours);
        assertEq(dripper.streamCapPerDay(), 1_000e18);
        vm.expectRevert(RewardDripper.ZeroAddress.selector);
        dripper.setVault(address(0));
        dripper.renounceOwnership();
        vm.stopPrank();
        assertEq(dripper.owner(), address(0));
    }

    function test_dripperRenounceBlockedWithoutVault() public {
        RewardDripper d2 = new RewardDripper(IERC20(address(comd)), address(0), admin);
        assertEq(d2.pending(), 0);
        vm.prank(admin);
        vm.expectRevert(RewardDripper.NoVault.selector);
        d2.renounceOwnership();
    }
}
