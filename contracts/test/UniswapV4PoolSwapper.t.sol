// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Base} from "./utils/Base.sol";
import {UniswapV4PoolSwapper} from "../src/swap/UniswapV4PoolSwapper.sol";
import {Flywheel} from "../src/Flywheel.sol";

/// @notice UniswapV4PoolSwapper against a real (hookless) v4 ETH/COMD pool on a local PoolManager. Pons's pool
///         carries Pons's hook, which cannot be reproduced here; the swapper's PoolKey is owner-settable so it is
///         pointed at that pool after graduation (and replaceable through `setSwapper` if the hook needs more).
contract UniswapV4PoolSwapperTest is Base {
    using PoolIdLibrary for PoolKey;

    function setUp() public {
        setUpSystem();
        setUpV4Pool();
    }

    function test_poolKeyAndOwner() public {
        PoolKey memory k = v4swapper.poolKey();
        assertEq(k.fee, POOL_FEE);
        assertEq(k.tickSpacing, POOL_SPACING);
        assertEq(address(k.hooks), address(0));
        assertEq(k.currency0.toId(), 0);
        assertEq(k.currency1.toId(), uint256(uint160(address(comd))));
        assertEq(PoolId.unwrap(v4swapper.poolId()), PoolId.unwrap(poolKey.toId()));
        assertTrue(v4swapper.configured());
        vm.prank(alice);
        vm.expectRevert();
        v4swapper.setPoolKey(500, 10, IHooks(address(0)));
        vm.prank(admin);
        vm.expectRevert(UniswapV4PoolSwapper.ZeroAmount.selector);
        v4swapper.setPoolKey(500, 0, IHooks(address(0)));
        assertEq(v4swapper.owner(), admin);
    }

    function test_unconfiguredReverts() public {
        UniswapV4PoolSwapper s = new UniswapV4PoolSwapper(manager, IERC20(address(comd)), admin);
        assertFalse(s.configured());
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(UniswapV4PoolSwapper.PoolNotSet.selector);
        s.swapExactETHForComd{value: 1 ether}(0, alice, block.timestamp);
        vm.prank(alice);
        vm.expectRevert(UniswapV4PoolSwapper.PoolNotSet.selector);
        s.swapExactComdForETH(1e18, 0, alice, block.timestamp);
        vm.expectRevert(UniswapV4PoolSwapper.PoolNotSet.selector);
        s.quoteETHForComd(1 ether);
        // ETH straight to the swapper is refused (only the PoolManager pays it)
        vm.prank(alice);
        (bool ok,) = address(s).call{value: 1}("");
        assertFalse(ok);
    }

    function test_swapEthForComdDeliversToRecipient() public {
        vm.deal(alice, 1 ether);
        uint256 q = v4swapper.quoteETHForComd(0.1 ether);
        assertGt(q, 0);
        // ≈ 0.1 ETH · 1e8 COMD/ETH · (1 − 0.3% fee), minus price impact on ≈ 5 ETH of liquidity
        assertLt(q, 0.1e8 ether);
        assertGt(q, 0.095e8 ether);
        vm.expectEmit(true, true, false, true, address(v4swapper));
        emit UniswapV4PoolSwapper.Swapped(alice, bob, true, 0.1 ether, q);
        vm.prank(alice);
        uint256 out = v4swapper.swapExactETHForComd{value: 0.1 ether}(q, bob, block.timestamp);
        assertEq(out, q, "quote equals execution in the same state");
        assertEq(comd.balanceOf(bob), out);
        assertEq(alice.balance, 0.9 ether);
        assertEq(address(v4swapper).balance, 0, "swapper holds nothing");
        assertEq(comd.balanceOf(address(v4swapper)), 0);
        assertLt(_tick(), POOL_TICK, "price of COMD in ETH went up (tick = COMD per ETH)");
    }

    function test_swapComdForEth() public {
        comd.transfer(alice, 10_000_000e18);
        uint256 q = v4swapper.quoteComdForETH(1_000_000e18);
        assertGt(q, 0.0099 ether);
        assertLt(q, 0.01 ether);
        vm.startPrank(alice);
        comd.approve(address(v4swapper), 1_000_000e18);
        uint256 out = v4swapper.swapExactComdForETH(1_000_000e18, q, bob, block.timestamp);
        vm.stopPrank();
        assertEq(out, q);
        assertEq(bob.balance, out);
        assertEq(comd.balanceOf(alice), 9_000_000e18);
        assertGt(_tick(), POOL_TICK, "more COMD per ETH after a sell");
    }

    function test_slippageDeadlineZero() public {
        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        vm.expectRevert();
        v4swapper.swapExactETHForComd{value: 0.1 ether}(type(uint256).max, alice, block.timestamp);
        vm.expectRevert(UniswapV4PoolSwapper.Expired.selector);
        v4swapper.swapExactETHForComd{value: 0.1 ether}(0, alice, block.timestamp - 1);
        vm.expectRevert(UniswapV4PoolSwapper.ZeroAmount.selector);
        v4swapper.swapExactETHForComd{value: 0}(0, alice, block.timestamp);
        vm.expectRevert(UniswapV4PoolSwapper.ZeroAmount.selector);
        v4swapper.swapExactComdForETH(0, 0, alice, block.timestamp);
        vm.stopPrank();
        assertEq(alice.balance, 1 ether);
        assertEq(v4swapper.quoteETHForComd(0), 0);
    }

    function test_onlyPoolManagerCallsBack() public {
        vm.expectRevert(UniswapV4PoolSwapper.NotPoolManager.selector);
        v4swapper.unlockCallback("");
    }

    function testFuzz_roundTripNeverProfits(uint256 ethIn) public {
        ethIn = bound(ethIn, 1e12, 2 ether);
        vm.deal(alice, ethIn);
        vm.startPrank(alice);
        uint256 got = v4swapper.swapExactETHForComd{value: ethIn}(0, alice, block.timestamp);
        comd.approve(address(v4swapper), got);
        uint256 back = v4swapper.swapExactComdForETH(got, 0, alice, block.timestamp);
        vm.stopPrank();
        assertLt(back, ethIn, "fees + impact");
        assertEq(alice.balance, back);
        assertEq(address(v4swapper).balance, 0);
        assertEq(comd.balanceOf(address(v4swapper)), 0);
    }

    /// The Flywheel buys back through the real pool and parks the COMD at the dead address.
    function test_flywheelBuybackThroughRealPool() public {
        useV4Swapper();
        _tax(1 ether);
        uint256 q = v4swapper.quoteETHForComd(0.5 ether);
        vm.prank(keeper);
        uint256 burned = flywheel.buyback(q);
        assertEq(burned, q);
        assertEq(comd.balanceOf(DEAD), q);
        assertEq(flywheel.totalBurned(), q);
        assertEq(flywheel.totalBoughtBack(), 0.5 ether);
        _assertTaxConservation();
    }

    /// Re-pointing to a different pool (new fee tier) is an owner action; swaps follow the new key.
    function test_repointPoolKey() public {
        vm.prank(admin);
        v4swapper.setPoolKey(10_000, 200, IHooks(address(0)));
        assertFalse(PoolId.unwrap(v4swapper.poolId()) == PoolId.unwrap(poolKey.toId()));
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(); // that pool does not exist
        v4swapper.swapExactETHForComd{value: 0.1 ether}(0, alice, block.timestamp);
        vm.prank(admin);
        v4swapper.setPoolKey(POOL_FEE, POOL_SPACING, IHooks(address(0)));
        vm.prank(alice);
        assertGt(v4swapper.swapExactETHForComd{value: 0.1 ether}(0, alice, block.timestamp), 0);
    }
}
