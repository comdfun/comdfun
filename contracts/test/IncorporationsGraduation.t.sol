// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

import {Base} from "./utils/Base.sol";
import {Incorporations} from "../src/Incorporations.sol";
import {LaunchGuardHook} from "../src/launch/LaunchGuardHook.sol";

/// Graduation: the buy that lifts a coin's COMD reserve to the threshold moves it into a Uniswap v4 coin/$COMD pool
/// at the curve price; the curve then refuses trades; the pool trades through any router; fees go to Counsel rewards.
contract IncorporationsGraduationTest is Base {
    using PoolIdLibrary for PoolKey;

    address launcher = makeAddr("launcher");
    address coin;

    function setUp() public {
        setUpSystem();
        vm.prank(admin);
        inc.setGraduationThreshold(400_000e18);
        vm.prank(launcher);
        coin = inc.create("Acme Litigation Co", "ACME", "ipfs-free://acme");
        comd.transfer(alice, 50_000_000e18);
        comd.transfer(bob, 50_000_000e18);
        vm.startPrank(alice);
        comd.approve(address(inc), type(uint256).max);
        IERC20(coin).approve(address(inc), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(bob);
        comd.approve(address(swapRouter), type(uint256).max);
        IERC20(coin).approve(address(swapRouter), type(uint256).max);
        vm.stopPrank();
    }

    function _buyUpTo(uint256 reserve) internal returns (uint256 lastOut) {
        // gross = net / 0.98 so that the net reaching the curve is `reserve`
        uint256 gross = (reserve * 10_000) / 9_800 + 1;
        vm.prank(alice);
        lastOut = inc.buyWithComd(coin, gross, 0);
    }

    function test_setup_hookWiredToIncorporations() public view {
        LaunchGuardHook h = LaunchGuardHook(address(inc.graduationHook()));
        assertEq(h.factory(), address(inc));
        assertEq(h.poolManager(), address(manager));
        assertEq(inc.graduationThreshold(), 400_000e18);
        assertEq(inc.graduationFee(), 10_000);
        assertEq(inc.graduationTickSpacing(), 200);
        assertEq(inc.installer(), address(this));
    }

    function test_graduatesOnTheCrossingBuy_atCurvePrice_andBurnsTheRest() public {
        uint256 priceBefore = inc.spotPrice(coin);
        assertEq(inc.comdToGraduate(coin), 400_000e18);
        uint256 backingBefore = inc.totalBacking();
        assertEq(backingBefore, 0);

        _buyUpTo(400_000e18);

        Incorporations.Graduation memory g = inc.graduationInfo(coin);
        assertTrue(g.done, "graduated");
        assertEq(inc.graduatedCount(), 1);
        assertEq(inc.isGraduated(coin), true);
        Incorporations.Coin memory c = inc.coinInfo(coin);
        assertEq(c.comdReserve, 0);
        assertEq(c.coinReserve, 0);
        assertEq(inc.totalBacking(), 0, "backing released to the pool");
        // the real COMD went in (minus wei of rounding), the coin side matched it, the rest burned
        assertApproxEqAbs(g.comdIn, 400_000e18, 1e6);
        assertGt(g.coinIn, 0);
        assertGt(g.coinBurned, 0);
        assertEq(IERC20(coin).balanceOf(address(inc)), 0, "no coins left on the curve");
        assertEq(IERC20(coin).balanceOf(inc.DEAD()), g.coinBurned);
        assertLe(inc.comdSurplus(), 1e6, "only dust left behind");
        // pool price == curve price at graduation: x = 100k virtual + 400k real, y = k / x = 200M coins → 0.0025 COMD
        uint256 priceAfter = inc.spotPrice(coin);
        assertGt(priceAfter, priceBefore);
        assertApproxEqRel(priceAfter, 2.5e15, 0.0005e18, "pool opens at the curve price");
        // the real COMD pairs with 400k/500k of the 200M unsold coins (160M); the virtual share (40M) is burned
        assertApproxEqRel(g.coinIn, 160_000_000e18, 0.001e18, "coins paired");
        assertApproxEqRel(g.coinBurned, 40_000_000e18, 0.001e18, "coins burned");
        (uint160 sqrtP,,,) = StateLibrary.getSlot0(manager, g.key.toId());
        assertGt(sqrtP, 0);
        // the pool pairs the coin with $COMD through our guard hook at the configured fee tier
        assertTrue(
            Currency.unwrap(g.key.currency0) == address(comd) || Currency.unwrap(g.key.currency1) == address(comd)
        );
        assertEq(g.key.fee, 10_000);
        assertEq(g.key.tickSpacing, 200);
        assertEq(address(g.key.hooks), address(inc.graduationHook()));
        assertEq(StateLibrary.getLiquidity(manager, g.key.toId()), g.liquidity);
    }

    function test_curveRefusesTradesAfterGraduation_poolTradesThroughAnyRouter() public {
        _buyUpTo(400_000e18);
        vm.startPrank(alice);
        vm.expectRevert(Incorporations.CoinGraduated.selector);
        inc.buyWithComd(coin, 1e18, 0);
        vm.expectRevert(Incorporations.CoinGraduated.selector);
        inc.sellForComd(coin, 1e18, 0);
        vm.expectRevert(Incorporations.CoinGraduated.selector);
        inc.quoteBuy(coin, 1e18);
        vm.expectRevert(Incorporations.CoinGraduated.selector);
        inc.quoteSell(coin, 1e18);
        vm.stopPrank();

        Incorporations.Graduation memory g = inc.graduationInfo(coin);
        bool coinIs0 = Currency.unwrap(g.key.currency0) == coin;
        uint256 coinBefore = IERC20(coin).balanceOf(bob);
        uint256 priceBefore = inc.spotPrice(coin);
        // bob buys the coin with 10,000 COMD on Uniswap (exact input; COMD -> coin direction)
        vm.prank(bob);
        swapRouter.swap(
            g.key,
            SwapParams({
                zeroForOne: !coinIs0,
                amountSpecified: -10_000e18,
                sqrtPriceLimitX96: !coinIs0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        assertGt(IERC20(coin).balanceOf(bob), coinBefore, "coin received from the pool");
        assertGt(inc.spotPrice(coin), priceBefore, "pool price moved up");
    }

    function test_poolFeesGoToCounselRewardsAndBurn() public {
        _buyUpTo(400_000e18);
        Incorporations.Graduation memory g = inc.graduationInfo(coin);
        bool coinIs0 = Currency.unwrap(g.key.currency0) == coin;
        vm.prank(bob);
        swapRouter.swap(
            g.key,
            SwapParams({
                zeroForOne: !coinIs0,
                amountSpecified: -100_000e18,
                sqrtPriceLimitX96: !coinIs0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        uint256 rewardsBefore = comd.balanceOf(address(distributor));
        uint256 toRewardsBefore = inc.totalToRewards();
        (uint256 comdFees, uint256 coinFees) = inc.collectPoolFees(coin);
        // a 1% pool fee on a 100,000 COMD buy ≈ 1,000 COMD, all to Counsel rewards
        assertApproxEqRel(comdFees, 1_000e18, 0.02e18);
        assertEq(coinFees, 0, "no coin-side fee on a COMD-in swap");
        assertEq(comd.balanceOf(address(distributor)), rewardsBefore + comdFees);
        assertEq(inc.totalToRewards(), toRewardsBefore + comdFees);
        assertEq(inc.graduationInfo(coin).feesComd, comdFees);
        // nothing left to collect
        (uint256 again,) = inc.collectPoolFees(coin);
        assertEq(again, 0);
        vm.expectRevert(Incorporations.NotGraduated.selector);
        inc.collectPoolFees(address(0xBEEF));
    }

    function test_graduatePermissionless_whenEligible_andThresholdBounds() public {
        // owner raises the threshold, alice buys to the old level, nothing graduates
        vm.prank(admin);
        inc.setGraduationThreshold(1_000_000e18);
        _buyUpTo(400_000e18);
        assertFalse(inc.isGraduated(coin));
        uint256 reserve = inc.coinInfo(coin).comdReserve;
        vm.expectRevert(abi.encodeWithSelector(Incorporations.NotEligible.selector, reserve, 1_000_000e18));
        inc.graduate(coin);
        // owner lowers it again: anyone can graduate the now-eligible coin
        vm.prank(admin);
        inc.setGraduationThreshold(300_000e18);
        assertEq(inc.comdToGraduate(coin), 0);
        vm.prank(carol);
        inc.graduate(coin);
        assertTrue(inc.isGraduated(coin));
        vm.expectRevert(Incorporations.CoinGraduated.selector);
        inc.graduate(coin);
        // bounds
        vm.startPrank(admin);
        vm.expectRevert(Incorporations.OutOfBounds.selector);
        inc.setGraduationThreshold(1e18);
        vm.expectRevert(Incorporations.BadFee.selector);
        inc.setGraduationFee(1234, 7);
        inc.setGraduationFee(3_000, 60);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert();
        inc.setGraduationThreshold(500_000e18);
    }

    function test_hookOnlyOnce_onlyInstallerOrOwner_mustPointHere() public {
        vm.expectRevert(Incorporations.AlreadySet.selector);
        inc.setGraduationHook(IHooks(address(1)));
        Incorporations fresh = new Incorporations(
            IERC20(address(comd)), address(distributor), inc.swapper(), manager, address(this), admin
        );
        assertEq(fresh.graduationThreshold(), 400_000e18, "default threshold");
        vm.prank(alice);
        vm.expectRevert(Incorporations.NotInstaller.selector);
        fresh.setGraduationHook(IHooks(address(1)));
        // a hook minted for another factory is refused
        LaunchGuardHook wrong = _mineGuardHook(address(inc));
        vm.expectRevert(Incorporations.BadHook.selector);
        fresh.setGraduationHook(IHooks(address(wrong)));
        // without a hook, buys never graduate and graduate() says why
        comd.transfer(alice, 1_000_000e18);
        vm.startPrank(alice);
        comd.approve(address(fresh), type(uint256).max);
        address c2 = fresh.create("Fresh", "FRSH", "");
        fresh.buyWithComd(c2, 500_000e18, 0);
        vm.stopPrank();
        assertFalse(fresh.isGraduated(c2));
        vm.expectRevert(Incorporations.HookNotSet.selector);
        fresh.graduate(c2);
        // the owner can wire it later and the eligible coin graduates
        LaunchGuardHook h = _mineGuardHook(address(fresh));
        vm.prank(admin);
        fresh.setGraduationHook(IHooks(address(h)));
        fresh.graduate(c2);
        assertTrue(fresh.isGraduated(c2));
    }

    function test_nobodyElseCanInitializeAPoolWithTheHook() public {
        PoolKey memory key = PoolKey(
            Currency.wrap(address(0)), Currency.wrap(address(comd)), 10_000, 200, inc.graduationHook()
        );
        vm.expectRevert();
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));
    }

    function test_pausedBlocksGraduation_rescueCannotTouchPoolOrBacking() public {
        vm.prank(admin);
        inc.setGraduationThreshold(1_000_000e18);
        _buyUpTo(400_000e18);
        vm.prank(admin);
        inc.pause();
        vm.prank(admin);
        inc.setGraduationThreshold(300_000e18);
        vm.expectRevert();
        inc.graduate(coin);
        vm.prank(admin);
        inc.unpause();
        inc.graduate(coin);
        // after graduation the curve holds no coin and only dust COMD: rescue is bounded by that
        vm.prank(admin);
        vm.expectRevert();
        inc.rescueERC20(IERC20(coin), admin, 1);
        uint256 dust = inc.comdSurplus();
        vm.prank(admin);
        vm.expectRevert();
        inc.rescueERC20(comd, admin, dust + 1);
    }

    function test_graduationViaEthBuyToo() public {
        // alice brings the reserve just under the threshold with COMD; bob's ETH buy crosses it
        _buyUpTo(399_000e18);
        vm.deal(bob, 10 ether);
        vm.prank(bob);
        inc.buyWithETH{value: 1 ether}(coin, 0); // 1 ETH = 1e8 COMD at the mock rate, far above the gap
        assertTrue(inc.isGraduated(coin));
    }
}
