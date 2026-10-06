// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {stdStorage, StdStorage} from "forge-std/StdStorage.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {CustomRevert} from "v4-core/src/libraries/CustomRevert.sol";

import {Base} from "./utils/Base.sol";
import {ComdTaxHook, IFlywheelTaxSink} from "../src/ComdTaxHook.sol";
import {TickAlign} from "../src/libraries/TickAlign.sol";

/// @notice Inventory cap, trims, the 85/6/4.5/4.5 split, cap ratchet and reference tick of the combined hook.
contract ComdTrimTest is Base {
    using stdStorage for StdStorage;

    function setUp() public {
        setUpSystem();
        initAndSeed(); // no market buy: the only room is what each test opens
    }

    struct Bal {
        uint256 supply;
        uint256 bond;
        uint256 dripper;
        uint256 seats;
        uint256 split;
    }

    function _bal() internal view returns (Bal memory b) {
        b.supply = comd.totalSupply();
        b.bond = comd.balanceOf(address(bond));
        b.dripper = comd.balanceOf(address(dripper));
        b.seats = comd.balanceOf(address(distributor));
        b.split = hook.stats().split;
    }

    function _assertSplit(Bal memory b, Bal memory a) internal pure {
        uint256 amount = a.split - b.split;
        uint256 burned = b.supply - a.supply;
        assertEq(burned + (a.bond - b.bond) + (a.dripper - b.dripper) + (a.seats - b.seats), amount, "sums exactly");
        assertEq(a.bond - b.bond, amount * 600 / 10_000, "6% bond");
        assertEq(a.dripper - b.dripper, amount * 450 / 10_000, "4.5% stakers");
        assertEq(a.seats - b.seats, amount * 450 / 10_000, "4.5% seats");
    }

    // ------------------------------------------------------------------ cap at seed

    function test_capStartsAtSeededInventory() public view {
        uint256 inv = hook.inventory();
        assertGt(inv, SUPPLY - 1e12);
        assertEq(hook.cap(), inv);
        assertEq(hook.currentCap(), inv);
        assertEq(hook.lastInventory(), inv);
        assertEq(hook.refTick(), hook.tickUpper());
        ComdTaxHook.Params memory p = hook.params();
        assertEq(p.capFloor, 100_000e18);
        assertEq(p.capDecayPerDay, 100_000e18);
        assertEq(p.burnBps, 8_500);
    }

    function test_buyOpensRoomNoTrim() public {
        uint256 c0 = hook.cap();
        uint256 got = _buy(alice, 1 ether);
        assertEq(hook.cap(), c0, "cap does not drop on buys");
        assertApproxEqAbs(c0 - hook.inventory(), got, 1e6);
        assertEq(hook.stats().trimmedComd, 0);
    }

    function test_sellWithinRoomNotTrimmed() public {
        uint256 got = _buy(alice, 1 ether);
        _sell(alice, got);
        assertEq(hook.stats().trimmedComd, 0, "no decay yet: no trim");
        assertEq(comd.totalSupply(), SUPPLY);
    }

    // ------------------------------------------------------------------ ratchet

    function test_capDecays100kPerDayTowardInventory() public {
        _buy(alice, 1 ether);
        uint256 c0 = hook.cap();
        uint256 inv = hook.inventory();
        vm.warp(block.timestamp + 1 days);
        assertEq(hook.currentCap(), c0 - 100_000e18);
        vm.warp(block.timestamp + 1 days);
        assertEq(hook.currentCap(), c0 - 200_000e18);
        vm.warp(block.timestamp + 100_000 days);
        assertEq(hook.currentCap(), inv, "never below the last inventory");
    }

    function test_washTradingDoesNotShrinkCap() public {
        uint256 c0 = hook.cap();
        for (uint256 i; i < 8; ++i) {
            uint256 out = _buy(alice, 0.5 ether);
            _sell(alice, out);
        }
        assertEq(hook.cap(), c0);
        assertEq(hook.stats().trimmedComd, 0);
    }

    // ------------------------------------------------------------------ trims + split

    function test_trimAfterDecaySplitsExactly() public {
        _fastDecay();
        Bal memory b = _bal();
        uint256 wallEth0 = address(wall).balance;
        _forceTrim(alice, 0.1 ether, 5); // ≈ 5,000,000 COMD over the decayed cap
        Bal memory a = _bal();
        ComdTaxHook.Stats memory st = hook.stats();
        assertApproxEqRel(st.trimmedComd, 5_000_000e18, 0.02e18);
        _assertSplit(b, a);
        assertLe(hook.inventory(), hook.cap() + 1, "inventory at/below cap after trim");
        assertEq(address(wall).balance - wallEth0 + hook.claimEth(), st.trimmedEth, "trim ETH to the BuyWall");
        _assertSplitConservation();
        _assertTaxConservation();
    }

    /// The executed amount of a swap that triggers a trim equals that of the same swap with trims disabled:
    /// trims never alter the (taxed) quote, nor the final price.
    function test_trimNeverAltersExecutedQuote() public {
        _fastDecay();
        uint256 got = _buy(alice, 0.1 ether);
        vm.warp(block.timestamp + 5 days);
        uint256 snap = vm.snapshotState();
        // branch A: no trim (cap forced far above inventory)
        stdstore.target(address(hook)).sig("cap()").checked_write(SUPPLY * 10);
        uint256 outNoTrim = _sell(alice, got);
        uint160 pNoTrim = _sqrtP();
        assertEq(hook.stats().trimmedComd, 0);
        vm.revertToState(snap);
        // branch B: trim
        uint256 quoted = router.quoteComdForETH(got);
        uint256 outTrim = _sell(alice, got);
        assertGt(hook.stats().trimmedComd, 0, "trim happened");
        assertEq(outTrim, outNoTrim, "identical executed amount");
        assertEq(outTrim, quoted, "router quote == executed");
        assertEq(_sqrtP(), pNoTrim, "trim did not move the price");
    }

    function testFuzz_trimSplitConservation(uint256 eth, uint256 days_) public {
        eth = bound(eth, 0.01 ether, 2 ether);
        days_ = bound(days_, 0, 30);
        _fastDecay();
        Bal memory b = _bal();
        _forceTrim(alice, eth, days_);
        _assertSplit(b, _bal());
        assertLe(hook.inventory(), hook.currentCap() + 1);
        _assertSplitConservation();
        _assertTaxConservation();
    }

    /// BuyWall wiring: unset on a fresh hook (trim ETH then waits as claims), set once, only it may call split.
    function test_buyWallWiringGuards() public {
        ComdTaxHook h2 = _deployHook(address(uint160(0x5555) << 144 | HOOK_FLAGS));
        assertEq(h2.buyWall(), address(0));
        vm.expectRevert(ComdTaxHook.NotBuyWall.selector);
        h2.split(1);
        vm.prank(admin);
        h2.setBuyWall(address(wall));
        vm.prank(admin);
        vm.expectRevert(ComdTaxHook.AlreadySet.selector);
        h2.setBuyWall(alice);
    }

    function test_splitOnlyBuyWall() public {
        vm.expectRevert(ComdTaxHook.NotBuyWall.selector);
        hook.split(1);
    }

    // ------------------------------------------------------------------ reference tick

    function test_referenceTickBlockLaggedAndRateLimited() public {
        int24 ref0 = hook.refTick();
        _buy(alice, 5 ether); // big move down in tick (COMD gets pricier)
        assertLt(_tick(), ref0 - 2_000);
        assertEq(hook.refTick(), ref0, "same block: unchanged");
        vm.roll(block.number + 1);
        hook.observe();
        assertEq(hook.refTick(), ref0 - 200, "next block: at most 200 ticks");
        vm.roll(block.number + 3);
        _buy(bob, 1e9);
        assertEq(hook.refTick(), ref0 - 800, "200 ticks per elapsed block");
    }

    // ------------------------------------------------------------------ owner

    function test_setParamsBounds() public {
        ComdTaxHook.Params memory p = hook.params();
        vm.expectRevert();
        hook.setParams(p);
        vm.startPrank(admin);
        p.burnBps = 4_000;
        p.bondBps = 2_400;
        p.stakersBps = 2_400;
        p.seatsBps = 1_200;
        vm.expectRevert(ComdTaxHook.BadParams.selector);
        hook.setParams(p);
        p = hook.params();
        p.capDecayPerDay = 1_000_001e18;
        vm.expectRevert(ComdTaxHook.BadParams.selector);
        hook.setParams(p);
        p = hook.params();
        p.capFloor = 999e18;
        vm.expectRevert(ComdTaxHook.BadParams.selector);
        hook.setParams(p);
        p = hook.params();
        p.refStepTicks = 0;
        vm.expectRevert(ComdTaxHook.BadParams.selector);
        hook.setParams(p);
        p = hook.params();
        p.burnBps = 9_000;
        p.bondBps = 400;
        p.stakersBps = 300;
        p.seatsBps = 300;
        hook.setParams(p);
        vm.expectRevert(ComdTaxHook.ZeroAddress.selector);
        hook.setDestinations(address(0), alice, alice);
        hook.setDestinations(alice, bob, carol);
        vm.stopPrank();
        assertEq(hook.params().burnBps, 9_000);
        assertEq(hook.bond(), alice);
    }
}
