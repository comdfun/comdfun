// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./utils/Base.sol";
import {ComdRouter} from "../src/ComdRouter.sol";

contract ComdRouterTest is Base {
    function setUp() public {
        setUpSystem();
        initSeedAndTrade();
    }

    function test_buyQuoteNetOfTaxMatchesExecution() public {
        uint256 q = router.quoteETHForComd(1 ether);
        uint256 taxed0 = hook.totalTaxed();
        uint256 out = _buy(alice, 1 ether);
        assertEq(out, q, "quote == executed (net of tax)");
        assertEq(comd.balanceOf(alice), out);
        assertEq(hook.totalTaxed() - taxed0, 0.05 ether);
    }

    function test_sellQuoteNetOfTaxMatchesExecution() public {
        deal(address(comd), alice, 10_000_000e18);
        uint256 q = router.quoteComdForETH(10_000_000e18);
        uint256 before = alice.balance;
        uint256 out = _sell(alice, 10_000_000e18);
        assertEq(out, q);
        assertEq(alice.balance - before, out);
    }

    function test_flywheelQuoteIsUntaxed() public {
        uint256 userQ = router.quoteETHForComd(1 ether);
        vm.prank(address(flywheel));
        uint256 fwQ = router.quoteETHForComd(1 ether);
        assertGt(fwQ, userQ, "only the Flywheel's own route is exempt");
        // the untaxed quote for 1 ETH equals the taxed quote of 1/0.95 ETH (same pool input)
        assertApproxEqRel(fwQ, router.quoteETHForComd(uint256(1 ether) * 10_000 / 9_500), 1e12);
    }

    function test_recipientDifferentFromSender() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 out = router.swapExactETHForComd{value: 1 ether}(0, bob, block.timestamp);
        assertEq(comd.balanceOf(bob), out);
        assertEq(comd.balanceOf(alice), 0);
    }

    function test_slippageDeadlineZero() public {
        vm.deal(alice, 10 ether);
        uint256 q = router.quoteETHForComd(1 ether);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(ComdRouter.Slippage.selector, q, q + 1));
        router.swapExactETHForComd{value: 1 ether}(q + 1, alice, block.timestamp);
        vm.expectRevert(ComdRouter.Expired.selector);
        router.swapExactETHForComd{value: 1 ether}(0, alice, block.timestamp - 1);
        vm.expectRevert(ComdRouter.ZeroAmount.selector);
        router.swapExactETHForComd{value: 0}(0, alice, block.timestamp);
        vm.expectRevert(ComdRouter.ZeroAmount.selector);
        router.swapExactComdForETH(0, 0, alice, block.timestamp);
        vm.stopPrank();
        assertEq(router.quoteETHForComd(0), 0);
    }

    function test_onlyPoolManagerCallback() public {
        vm.expectRevert(ComdRouter.NotPoolManager.selector);
        router.unlockCallback("");
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(router).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function testFuzz_roundTripLosesTaxTwice(uint256 ethIn) public {
        ethIn = bound(ethIn, 1e12, 5 ether);
        uint256 out = _buy(alice, ethIn);
        uint256 back = _sell(alice, out);
        assertLt(back, ethIn * 9_500 / 10_000, "at least the buy tax");
        assertGt(back, ethIn * 89 / 100, "about 2 x 5% (+ rounding)");
        _assertTaxConservation();
    }
}
