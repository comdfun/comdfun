// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {CustomRevert} from "v4-core/src/libraries/CustomRevert.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";

import {Base} from "./utils/Base.sol";
import {ComdTaxHook} from "../src/ComdTaxHook.sol";
import {TickAlign} from "../src/libraries/TickAlign.sol";
import {LaunchMath} from "../src/libraries/LaunchMath.sol";

contract ComdTaxHookTest is Base {
    function setUp() public {
        setUpSystem();
    }

    function _expectWrapped(bytes4 hookSel, bytes memory inner) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                hookSel,
                inner,
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
    }

    function _approveRaw() internal {
        comd.approve(address(swapRouter), type(uint256).max);
        vm.deal(address(this), 1_000 ether);
    }

    // ------------------------------------------------------------------ seeding (C-01 lesson)

    function test_initializeAndSeedAtomic() public {
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, HOOK_FLAGS);
        assertEq(HOOK_FLAGS, 0x18CC);
        initAndSeed();
        assertTrue(hook.seeded());
        // 100% of supply in the pool (minus at most rounding dust left with POL)
        assertLt(comd.balanceOf(pol), 1e12, "dust only");
        assertGt(comd.balanceOf(address(manager)), SUPPLY - 1e12);
        assertGt(hook.positionLiquidity(), 0);
        // opening tick = floor(tick of 1e8 COMD/ETH, 200)
        int24 expected = TickAlign.floor(LaunchMath.openingTick(false, MCAP, SUPPLY), 200);
        assertEq(_tick(), expected);
        assertEq(hook.tickUpper(), expected);
        assertEq(hook.tickLower(), TickAlign.minUsable(200));
    }

    function test_onlyPolOnce() public {
        vm.prank(alice);
        vm.expectRevert(ComdTaxHook.NotPol.selector);
        hook.initializeAndSeed(MCAP, SUPPLY);
        initAndSeed();
        vm.prank(pol);
        vm.expectRevert(ComdTaxHook.AlreadySeeded.selector);
        hook.initializeAndSeed(MCAP, 1);
    }

    function test_noSwapBeforeSeed_externalInitRefused() public {
        // nobody (not even POL) can initialize the official pool from outside
        _expectWrapped(IHooks.afterInitialize.selector, abi.encodeWithSelector(ComdTaxHook.ExternalInitialize.selector));
        vm.prank(pol);
        manager.initialize(poolKey, TickMath.getSqrtPriceAtTick(0));
        // so there is no pool to swap on before initializeAndSeed
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        router.swapExactETHForComd{value: 1 ether}(0, alice, block.timestamp);
        // other pools using this hook are refused too
        PoolKey memory k2 = poolKey;
        k2.fee = 3000;
        k2.tickSpacing = 60;
        _expectWrapped(IHooks.afterInitialize.selector, abi.encodeWithSelector(ComdTaxHook.ExternalInitialize.selector));
        manager.initialize(k2, TickMath.getSqrtPriceAtTick(0));
    }

    function test_thirdPartyLiquidityBlocked() public {
        initSeedAndTrade();
        deal(address(comd), address(this), 1_000_000e18);
        comd.approve(address(modifyLiquidityRouter), type(uint256).max);
        vm.deal(address(this), 10 ether);
        _expectWrapped(IHooks.beforeAddLiquidity.selector, abi.encodeWithSelector(ComdTaxHook.OnlyProtocolLiquidity.selector));
        modifyLiquidityRouter.modifyLiquidity{value: 10 ether}(
            poolKey, ModifyLiquidityParams({tickLower: -887200, tickUpper: 887200, liquidityDelta: 1e18, salt: 0}), ""
        );
    }

    function test_callbacksOnlyFromManager() public {
        vm.expectRevert(ComdTaxHook.NotPoolManager.selector);
        hook.afterSwap(address(this), poolKey, SwapParams(true, -1, 0), BalanceDelta.wrap(0), "");
        vm.expectRevert(ComdTaxHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), poolKey, SwapParams(true, -1, 0), "");
        vm.expectRevert(ComdTaxHook.NotPoolManager.selector);
        hook.unlockCallback("");
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(hook).call{value: 1}("");
        assertFalse(ok, "hook refuses stray ETH");
    }

    // ------------------------------------------------------------------ tax exactness

    /// buy exact-in: buyer pays exactly T; tax = 5% of T; the pool swaps T − tax (same output as an untaxed
    /// swap of T − tax).
    function test_buyExactInTax() public {
        initSeedAndTrade();
        _approveRaw();
        uint256 T = 1 ether;
        uint256 tax = T * 500 / BPS;
        uint256 snap = vm.snapshotState();
        vm.deal(address(flywheel), 1 ether);
        vm.prank(address(flywheel));
        uint256 untaxedOut = router.swapExactETHForComd{value: T - tax}(0, address(flywheel), block.timestamp);
        vm.revertToState(snap);

        uint256 taxed0 = hook.totalTaxed();
        BalanceDelta d = _rawSwap(true, -int256(T), T);
        assertEq(-int256(d.amount0()), int256(T), "buyer pays exactly T");
        assertEq(hook.totalTaxed() - taxed0, tax, "tax = 5% of ETH in");
        assertEq(uint256(int256(d.amount1())), untaxedOut, "pool swapped T - tax");
        _assertTaxConservation();
    }

    /// buy exact-out: buyer gets exactly X COMD and pays poolIn + tax with tax = poolIn·500/9500 (= 5% of paid).
    function test_buyExactOutTax() public {
        initSeedAndTrade();
        _approveRaw();
        uint256 X = 10_000_000e18;
        uint256 taxed0 = hook.totalTaxed();
        BalanceDelta d = _rawSwap(true, int256(X), 5 ether);
        uint256 paid = uint256(-int256(d.amount0()));
        uint256 tax = hook.totalTaxed() - taxed0;
        assertEq(uint256(int256(d.amount1())), X, "exact COMD out");
        assertEq(tax, (paid - tax) * 500 / 9_500);
        assertApproxEqAbs(tax, paid * 500 / BPS, 1, "5% of what the buyer paid");
        _assertTaxConservation();
    }

    /// sell exact-in: seller receives gross − tax with tax = 5% of gross ETH out.
    function test_sellExactInTax() public {
        initSeedAndTrade();
        _approveRaw();
        deal(address(comd), address(this), 50_000_000e18);
        uint256 taxed0 = hook.totalTaxed();
        uint256 ethBefore = address(this).balance;
        BalanceDelta d = _rawSwap(false, -int256(50_000_000e18), 0);
        uint256 net = uint256(int256(d.amount0()));
        uint256 tax = hook.totalTaxed() - taxed0;
        assertEq(address(this).balance - ethBefore, net);
        assertEq(uint256(-int256(d.amount1())), 50_000_000e18);
        assertEq(tax, (net + tax) * 500 / BPS, "tax = 5% of gross ETH out");
        assertGt(tax, 0);
        _assertTaxConservation();
    }

    /// sell exact-out: seller receives exactly Y ETH; the pool paid Y + tax, tax = Y·500/9500 (= 5% of gross).
    function test_sellExactOutTax() public {
        initSeedAndTrade();
        _approveRaw();
        deal(address(comd), address(this), 500_000_000e18);
        uint256 Y = 0.5 ether;
        uint256 taxed0 = hook.totalTaxed();
        BalanceDelta d = _rawSwap(false, int256(Y), 0);
        assertEq(uint256(int256(d.amount0())), Y, "exact ETH out");
        uint256 tax = hook.totalTaxed() - taxed0;
        assertEq(tax, Y * 500 / 9_500);
        assertApproxEqAbs(tax, (Y + tax) * 500 / BPS, 1);
        _assertTaxConservation();
    }

    function testFuzz_taxAllKinds(uint256 amt, uint8 kind) public {
        initSeedAndTrade();
        _approveRaw();
        deal(address(comd), address(this), 900_000_000e18);
        kind = kind % 4;
        uint256 taxed0 = hook.totalTaxed();
        BalanceDelta d;
        if (kind == 0) {
            amt = bound(amt, 1e9, 30 ether);
            d = _rawSwap(true, -int256(amt), amt);
            assertEq(hook.totalTaxed() - taxed0, amt * 500 / BPS);
        } else if (kind == 1) {
            amt = bound(amt, 1e18, 50_000_000e18);
            d = _rawSwap(true, int256(amt), 100 ether);
            uint256 paid = uint256(-int256(d.amount0()));
            uint256 tax = hook.totalTaxed() - taxed0;
            assertEq(tax, (paid - tax) * 500 / 9_500);
        } else if (kind == 2) {
            amt = bound(amt, 1e18, 300_000_000e18);
            d = _rawSwap(false, -int256(amt), 0);
            uint256 tax = hook.totalTaxed() - taxed0;
            assertEq(tax, (uint256(int256(d.amount0())) + tax) * 500 / BPS);
        } else {
            amt = bound(amt, 1e9, 15 ether);
            d = _rawSwap(false, int256(amt), 0);
            assertEq(uint256(int256(d.amount0())), amt);
            assertEq(hook.totalTaxed() - taxed0, amt * 500 / 9_500);
        }
        _assertTaxConservation();
    }

    // ------------------------------------------------------------------ claims path

    /// The very first buy runs before the PoolManager holds any ETH: the tax is kept as ERC-6909 claims and
    /// forwarded by flush().
    function test_firstBuyTaxHeldAsClaimsThenFlushed() public {
        initAndSeed();
        assertEq(address(manager).balance, 0);
        _buy(alice, 1 ether);
        assertEq(hook.pendingTax(), 0.05 ether);
        assertEq(manager.balanceOf(address(hook), 0), 0.05 ether);
        assertEq(flywheel.totalTaxIn(), 0);
        _assertTaxConservation();
        hook.flush();
        assertEq(hook.pendingTax(), 0);
        assertEq(manager.balanceOf(address(hook), 0), 0);
        assertEq(flywheel.totalTaxIn(), 0.05 ether);
        _assertTaxConservation();
        vm.expectRevert(ComdTaxHook.NothingToFlush.selector);
        hook.flush();
        // once the pool holds ETH, tax is forwarded at once
        _buy(bob, 1 ether);
        assertEq(hook.pendingTax(), 0);
        assertEq(flywheel.totalTaxIn(), 0.1 ether);
    }

    // ------------------------------------------------------------------ partial fills

    function test_taxedPartialFillReverts() public {
        initSeedAndTrade();
        _approveRaw();
        // a price limit just below the current price stops a large exact-in buy early
        uint160 limit = TickMath.getSqrtPriceAtTick(_tick() - 10);
        vm.expectRevert(); // TaxedPartialFill (wrapped)
        swapRouter.swap{value: 50 ether}(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -50 ether, sqrtPriceLimitX96: limit}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    // ------------------------------------------------------------------ owner

    function test_taxBpsBoundsAndZero() public {
        initSeedAndTrade();
        vm.prank(alice);
        vm.expectRevert();
        hook.setTaxBps(100);
        vm.startPrank(admin);
        vm.expectRevert(ComdTaxHook.BadTax.selector);
        hook.setTaxBps(501);
        hook.setTaxBps(0);
        vm.stopPrank();
        uint256 t0 = hook.totalTaxed();
        _buy(alice, 1 ether);
        _sell(alice, comd.balanceOf(alice));
        assertEq(hook.totalTaxed(), t0, "no tax at 0 bps");
        vm.prank(admin);
        hook.setTaxBps(250);
        _buy(alice, 1 ether);
        assertEq(hook.totalTaxed() - t0, 0.025 ether);
    }

    function test_routerSetOnce() public {
        vm.prank(admin);
        vm.expectRevert(ComdTaxHook.AlreadySet.selector);
        hook.setRouter(alice);
        assertEq(hook.router(), address(router));
    }

    function test_renounce() public {
        vm.prank(admin);
        hook.renounceOwnership();
        vm.prank(admin);
        vm.expectRevert();
        hook.setTaxBps(0);
        assertEq(hook.taxBps(), 500);
    }
}
