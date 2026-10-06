// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Base} from "../utils/Base.sol";
import {Flywheel} from "../../src/Flywheel.sol";
import {ComdTaxHook} from "../../src/ComdTaxHook.sol";
import {ComdRouter} from "../../src/ComdRouter.sol";
import {ReentrantAdapter} from "../mocks/Mocks.sol";
import {BuyWall, IComdTaxHookForWall} from "../../src/BuyWall.sol";

/// @notice A contract that calls the official router itself (pretending to be anything) — gets taxed.
contract RouterCaller {
    ComdRouter public router;

    constructor(ComdRouter r) {
        router = r;
    }

    function buy() external payable returns (uint256) {
        return router.swapExactETHForComd{value: msg.value}(0, msg.sender, block.timestamp);
    }
}

/// @notice A custom unlock caller that swaps on the official pool with forged hookData claiming the Flywheel.
contract ForgedExemptSwapper is IUnlockCallback {
    IPoolManager public pm;
    PoolKey public key;
    address public flywheel;

    constructor(IPoolManager pm_, PoolKey memory key_, address flywheel_) {
        pm = pm_;
        key = key_;
        flywheel = flywheel_;
    }

    function buy() external payable {
        pm.unlock(abi.encode(msg.value));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        uint256 amt = abi.decode(data, (uint256));
        BalanceDelta d = pm.swap(
            key,
            SwapParams({zeroForOne: true, amountSpecified: -int256(amt), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            abi.encode(flywheel) // forged exemption claim
        );
        pm.settle{value: uint256(uint128(-d.amount0()))}();
        pm.take(key.currency1, address(this), uint256(uint128(d.amount1())));
        return "";
    }
}

contract TaxHookSecurityTest is Base {
    function setUp() public {
        setUpSystem();
        initSeedAndTrade();
    }

    // =====================================================================================
    //                              re-entrancy via the flywheel
    // =====================================================================================

    /// The Flywheel's buyback swaps on the official pool; if it were taxed, the hook would push ETH into the
    /// Flywheel in the middle of its own buyback (a loop). The router-attested exemption prevents that.
    function test_buybackNotTaxedIntoItself() public {
        uint256 taxIn0 = flywheel.totalTaxIn();
        uint256 taxed0 = hook.totalTaxed();
        vm.recordLogs();
        vm.prank(keeper);
        flywheel.buyback(1);
        assertEq(flywheel.totalTaxIn(), taxIn0, "no TaxIn during buyback");
        assertEq(hook.totalTaxed(), taxed0);
        _assertTaxConservation();
    }

    /// A malicious marketplace adapter (even one that is also the keeper) tries to re-enter buyback, awardSwept
    /// and sweep in the middle of a sweep: every attempt hits the reentrancy guard; buckets stay conserved.
    function test_reentrantAdapterBlocked() public {
        ReentrantAdapter ra = new ReentrantAdapter();
        vm.startPrank(admin);
        flywheel.setAdapter(address(ra), true);
        flywheel.setKeeper(address(ra));
        counsel.reserveMint(address(ra), 3); // ids 1..3 held by the adapter
        vm.stopPrank();
        bytes[3] memory payloads = [
            abi.encodeCall(Flywheel.buyback, (0)),
            abi.encodeCall(Flywheel.awardSwept, (1, address(ra))),
            abi.encodeCall(Flywheel.sweep, (address(ra), bytes(""), 2, 0.01 ether))
        ];
        for (uint256 i; i < 3; ++i) {
            ra.arm(address(flywheel), payloads[i]);
            (uint256 b0, uint256 s0) = flywheel.bucketBalances();
            vm.prank(address(ra));
            flywheel.sweep(address(ra), "", i + 1, 0.1 ether);
            assertFalse(ra.reentered(), "re-entry must fail");
            if (i != 1) assertEq(bytes4(ra.reason()), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
            (uint256 b1, uint256 s1) = flywheel.bucketBalances();
            assertEq(b1, b0);
            assertEq(s1, s0, "free delivery: full refund");
            assertEq(counsel.ownerOf(i + 1), address(flywheel));
        }
        // a direct notifyTax from the adapter is refused
        vm.deal(address(ra), 1 ether);
        vm.prank(address(ra));
        vm.expectRevert(Flywheel.NotHook.selector);
        flywheel.notifyTax{value: 1}();
        _assertTaxConservation();
    }

    // =====================================================================================
    //                                    tax bypass
    // =====================================================================================

    function test_thirdPartyRouterWithForgedHookDataIsTaxed() public {
        uint256 t0 = hook.totalTaxed();
        vm.deal(address(this), 2 ether);
        swapRouter.swap{value: 1 ether}(
            poolKey,
            SwapParams({zeroForOne: true, amountSpecified: -1 ether, sqrtPriceLimitX96: MIN_PRICE_LIMIT}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            abi.encode(address(flywheel)) // forged
        );
        assertEq(hook.totalTaxed() - t0, 0.05 ether);
    }

    function test_customUnlockCallerWithForgedHookDataIsTaxed() public {
        ForgedExemptSwapper f = new ForgedExemptSwapper(manager, poolKey, address(flywheel));
        uint256 t0 = hook.totalTaxed();
        vm.deal(address(this), 1 ether);
        f.buy{value: 1 ether}();
        assertEq(hook.totalTaxed() - t0, 0.05 ether);
    }

    function test_contractCallingOfficialRouterIsTaxed() public {
        RouterCaller rc = new RouterCaller(router);
        uint256 t0 = hook.totalTaxed();
        vm.deal(address(this), 1 ether);
        rc.buy{value: 1 ether}();
        assertEq(hook.totalTaxed() - t0, 0.05 ether);
    }

    /// Other pools cannot reuse this hook, and a separate hookless COMD/ETH pool has its own liquidity:
    /// trading there never touches the official pool's position.
    function test_otherPoolsCannotReachOfficialLiquidity() public {
        PoolKey memory alt = poolKey;
        alt.fee = 500;
        alt.tickSpacing = 10;
        uint160 p = _sqrtP();
        vm.expectRevert();
        manager.initialize(alt, p);

        PoolKey memory free = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(comd)), 3000, 60, IHooks(address(0)));
        manager.initialize(free, _sqrtP());
        deal(address(comd), address(this), 10_000_000e18);
        comd.approve(address(modifyLiquidityRouter), type(uint256).max);
        vm.deal(address(this), 10 ether);
        modifyLiquidityRouter.modifyLiquidity{value: 1 ether}(
            free, ModifyLiquidityParams({tickLower: -887220, tickUpper: 887220, liquidityDelta: 1e20, salt: 0}), ""
        );
        uint128 liq0 = hook.positionLiquidity();
        uint160 p0 = _sqrtP();
        swapRouter.swap{value: 0.1 ether}(
            free,
            SwapParams({zeroForOne: true, amountSpecified: -0.1 ether, sqrtPriceLimitX96: MIN_PRICE_LIMIT}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        assertEq(hook.positionLiquidity(), liq0);
        assertEq(_sqrtP(), p0, "official pool untouched");
    }

    /// Price limits cannot shrink a beforeSwap-charged tax: the swap must fill completely.
    function test_partialFillCannotUnderpayTax() public {
        uint160 limit = TickMath.getSqrtPriceAtTick(_tick() + 10); // sells push the tick up
        deal(address(comd), address(this), 500_000_000e18);
        comd.approve(address(swapRouter), type(uint256).max);
        vm.expectRevert();
        swapRouter.swap(
            poolKey,
            SwapParams({zeroForOne: false, amountSpecified: 5 ether, sqrtPriceLimitX96: limit}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    // =====================================================================================
    //                                  donation griefing
    // =====================================================================================

    function test_donationsToPoolHookFlywheelAreHarmless() public {
        // PoolManager.donate to the official pool: goes to the locked protocol position; tax still exact
        vm.deal(address(this), 5 ether);
        donateRouter.donate{value: 1 ether}(poolKey, 1 ether, 0, "");
        uint256 t0 = hook.totalTaxed();
        _buy(alice, 1 ether);
        assertEq(hook.totalTaxed() - t0, 0.05 ether);
        // ETH straight to the hook or the Flywheel is refused (no unaccounted balances)
        (bool ok,) = address(hook).call{value: 1}("");
        assertFalse(ok);
        (ok,) = address(flywheel).call{value: 1}("");
        assertFalse(ok);
        // COMD sent to the hook/flywheel changes no accounting
        deal(address(comd), address(this), 1e18);
        comd.transfer(address(hook), 1e18 / 2);
        comd.transfer(address(flywheel), 1e18 / 2);
        vm.prank(keeper);
        flywheel.buyback(1);
        // ETH sent to the RewardDistributor just becomes unallocated (cannot break posted roots)
        uint256 out0 = distributor.outstanding(address(0));
        (ok,) = address(distributor).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(distributor.outstanding(address(0)), out0);
        assertEq(distributor.unallocated(address(0)), 1 ether);
        _assertTaxConservation();
    }

    function test_flushSpamHarmless() public {
        for (uint256 i; i < 3; ++i) {
            vm.expectRevert(ComdTaxHook.NothingToFlush.selector);
            hook.flush();
        }
        _assertTaxConservation();
    }
}

/// @notice V3: the combined hook (tax + capped inventory) and its BuyWall.
contract CombinedHookSecurityTest is Base {
    function setUp() public {
        setUpSystem();
        initSeedAndTrade();
    }

    /// Only the registered BuyWall may add liquidity; a second BuyWall deployed by anyone is refused.
    function test_onlyRegisteredBuyWallMayAddLiquidity() public {
        BuyWall rogue = new BuyWall(IComdTaxHookForWall(address(hook)), alice);
        vm.deal(address(rogue), 1 ether);
        vm.expectRevert(); // OnlyProtocolLiquidity (wrapped)
        rogue.rebalance();
        vm.deal(address(wall), 1 ether);
        wall.rebalance();
        assertGt(wall.wallLiquidity(), 0, "the real wall can post");
    }

    function test_splitAndEthGuards() public {
        vm.expectRevert(ComdTaxHook.NotBuyWall.selector);
        hook.split(1);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(wall).call{value: 1}("");
        assertFalse(ok, "wall takes ETH only from the PoolManager");
        vm.expectRevert(BuyWall.NotPoolManager.selector);
        wall.unlockCallback("");
    }

    /// Trims never pay the swapper and never touch the tax: across a trimming sell, the seller's ETH equals the
    /// untaxed-equivalent minus exactly 5%, and tax + split stay conserved.
    function test_trimAndTaxIndependent() public {
        _fastDecay();
        uint256 got = _buy(alice, 1 ether);
        vm.warp(block.timestamp + 2_000 days);
        uint256 t0 = hook.totalTaxed();
        uint256 before = alice.balance;
        uint256 out = _sell(alice, got);
        assertGt(hook.stats().trimmedComd, 0, "trimmed");
        uint256 tax = hook.totalTaxed() - t0;
        assertEq(alice.balance - before, out);
        assertEq(tax, (out + tax) * 500 / 10_000, "tax is exactly 5% of gross even with a trim");
        _assertTaxConservation();
        _assertSplitConservation();
    }

    /// Re-entrancy via the flywheel during trims: the hook's afterSwap calls Flywheel.notifyTax (accounting only)
    /// and then trims; the Flywheel cannot be re-entered into buyback/sweep from there (keeper-only, nonReentrant).
    function test_buybackDuringTrimHeavyStateStaysConserved() public {
        _fastDecay();
        _forceTrim(bob, 2 ether, 2_000);
        vm.prank(keeper);
        flywheel.buyback(1);
        _assertTaxConservation();
        _assertSplitConservation();
    }
}

/// @notice Pending ERC-6909 tax claims belong to the hook; only `flush` (to the Flywheel) redeems them.
contract TaxClaimsSecurityTest is Base {
    function setUp() public {
        setUpSystem();
        initAndSeed();
        _buy(alice, 1 ether); // first buy: the PoolManager holds no ETH yet → tax held as claims
    }

    function test_claimsOnlyRedeemableByHook() public {
        assertEq(hook.pendingTax(), 0.05 ether);
        vm.expectRevert();
        manager.transferFrom(address(hook), address(this), 0, 1);
        vm.expectRevert();
        manager.burn(address(hook), 0, 1);
        vm.prank(alice);
        hook.flush(); // permissionless, always to the Flywheel
        assertEq(flywheel.totalTaxIn(), 0.05 ether);
        _assertTaxConservation();
    }
}
