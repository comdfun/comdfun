// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "./utils/Base.sol";
import {Incorporations} from "../src/Incorporations.sol";
import {IBuybackSwapper} from "../src/interfaces/IBuybackSwapper.sol";

contract IncorporationsTest is Base {
    address launcher = makeAddr("launcher");
    address coin;

    function setUp() public {
        setUpSystem();
        vm.prank(launcher);
        coin = inc.create("Acme Litigation Co", "ACME", "https://api.example/coins/acme.json");
        comd.transfer(alice, 10_000_000e18);
        vm.prank(alice);
        comd.approve(address(inc), type(uint256).max);
        vm.prank(alice);
        IERC20(coin).approve(address(inc), type(uint256).max);
    }

    function test_create() public {
        assertEq(inc.coinCount(), 1);
        assertEq(inc.coins(0), coin);
        assertEq(IERC20(coin).totalSupply(), 1_000_000_000e18);
        assertEq(IERC20(coin).balanceOf(address(inc)), 1_000_000_000e18);
        Incorporations.Coin memory c = inc.coinInfo(coin);
        assertEq(c.creator, launcher);
        assertEq(c.virtualComd, 100_000e18);
        assertEq(c.metadataURI, "https://api.example/coins/acme.json");
        // spot = 100k / 1B = 0.0001 COMD per coin
        assertEq(inc.spotPrice(coin), 1e14);
        vm.expectRevert(Incorporations.EmptyName.selector);
        inc.create("", "X", "");
        assertEq(address(inc.comd()), address(comd));
        assertEq(inc.rewardDistributor(), address(distributor));
        assertEq(address(inc.swapper()), address(swapper));
    }

    function test_createEmitsEvent() public {
        vm.expectEmit(false, true, false, true);
        emit Incorporations.CoinCreated(address(0), bob, "Bob LLP", "BOB", "ipfs-free://bob");
        vm.prank(bob);
        inc.create("Bob LLP", "BOB", "ipfs-free://bob");
    }

    function test_buySellWithComdFees() public {
        uint256 supply0 = comd.totalSupply();
        uint256 rew0 = comd.balanceOf(address(distributor));
        uint256 q = inc.quoteBuy(coin, 10_000e18);
        vm.expectEmit(true, false, false, true, address(inc));
        emit Incorporations.Fees(coin, 100e18, 50e18, 50e18, 0);
        vm.expectEmit(true, true, false, true);
        emit Incorporations.Trade(coin, alice, true, 10_000e18, q, 0);
        vm.prank(alice);
        uint256 out = inc.buyWithComd(coin, 10_000e18, q);
        assertEq(out, q);
        assertEq(IERC20(coin).balanceOf(alice), out);
        assertEq(comd.balanceOf(address(distributor)) - rew0, 100e18, "1% to Counsel rewards");
        assertEq(distributor.unallocated(address(comd)), 100e18, "claimable by settler roots");
        assertEq(comd.totalSupply(), supply0, "no burn(): supply unchanged");
        assertEq(comd.balanceOf(DEAD), 50e18, "0.5% to the dead address");
        assertEq(inc.totalBurned(), 50e18);
        assertEq(inc.totalToRewards(), 100e18);
        assertEq(comd.balanceOf(launcher), 50e18, "0.5% launcher in COMD");
        assertEq(inc.coinInfo(coin).comdReserve, 9_800e18);
        assertEq(inc.totalBacking(), 9_800e18);

        uint256 qs = inc.quoteSell(coin, out);
        vm.prank(alice);
        uint256 back = inc.sellForComd(coin, out, qs);
        assertEq(back, qs);
        // round trip loses the 2% + 2% fees (and rounding), never gains
        assertLt(back, 10_000e18 * 97 / 100);
        assertGt(back, 10_000e18 * 95 / 100);
        assertLe(inc.totalBacking(), 1);
    }

    function test_slippageUnknownZero() public {
        uint256 q = inc.quoteBuy(coin, 1_000e18);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Incorporations.Slippage.selector, q, q + 1));
        inc.buyWithComd(coin, 1_000e18, q + 1);
        vm.expectRevert(Incorporations.UnknownCoin.selector);
        inc.buyWithComd(address(comd), 1_000e18, 0);
        vm.expectRevert(Incorporations.ZeroAmount.selector);
        inc.buyWithComd(coin, 0, 0);
        vm.expectRevert(Incorporations.ZeroAmount.selector);
        inc.sellForComd(coin, 0, 0);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ ETH paths (mock venue)

    function test_buySellWithEthViaSwapper() public {
        vm.deal(bob, 10 ether);
        uint256 dead0 = comd.balanceOf(DEAD);
        vm.prank(bob);
        uint256 out = inc.buyWithETH{value: 1 ether}(coin, 1);
        assertGt(out, 0);
        assertEq(IERC20(coin).balanceOf(bob), out);
        assertEq(inc.launcherEthOwed(launcher), 0.005 ether, "0.5% of the ETH side");
        assertEq(comd.balanceOf(launcher), 0, "no COMD launcher fee on ETH trades");
        // 0.995 ETH → 0.995e8 COMD: 1% rewards, 0.5% burned
        assertEq(comd.balanceOf(DEAD) - dead0, 0.995e8 ether * 50 / 10_000, "0.5% COMD to the dead address");
        assertEq(comd.balanceOf(address(distributor)), 0.995e8 ether * 100 / 10_000);
        assertEq(address(inc).balance, 0.005 ether, "only the launcher's ETH stays");

        vm.startPrank(bob);
        IERC20(coin).approve(address(inc), out);
        uint256 before = bob.balance;
        uint256 ethOut = inc.sellForETH(coin, out, 1);
        vm.stopPrank();
        assertEq(bob.balance - before, ethOut);
        // fixed-rate venue: ≈ 0.995 · 0.985 · 0.985 · 0.995 ≈ 0.960
        assertLt(ethOut, 0.961 ether);
        assertGt(ethOut, 0.955 ether);
        assertGt(inc.launcherEthOwed(launcher), 0.005 ether);
        assertEq(comd.balanceOf(address(inc)), inc.totalBacking(), "no COMD stranded");

        uint256 owed = inc.launcherEthOwed(launcher);
        vm.prank(launcher);
        inc.claimLauncherEth();
        assertEq(launcher.balance, owed);
        assertEq(inc.launcherEthOwed(launcher), 0);
        assertEq(address(inc).balance, 0);
    }

    function test_ethBuyRefundsUnusedEth() public {
        swapper.setRefundBps(1_000); // venue only fills 90%
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        inc.buyWithETH{value: 1 ether}(coin, 1);
        assertEq(bob.balance, 0.0995 ether, "unused ETH back to the trader");
        assertEq(address(inc).balance, 0.005 ether);
    }

    function test_ethSlippage() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert();
        inc.buyWithETH{value: 1 ether}(coin, type(uint256).max);
        assertEq(bob.balance, 1 ether);
    }

    function test_ethPathsRevertUntilSwapperSet() public {
        Incorporations i2 = new Incorporations(IERC20(address(comd)), address(distributor), IBuybackSwapper(address(0)), manager, address(this), admin);
        vm.prank(bob);
        address c2 = i2.create("No Venue Yet", "NVY", "");
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(Incorporations.SwapperNotSet.selector);
        i2.buyWithETH{value: 1 ether}(c2, 0);
        vm.prank(bob);
        vm.expectRevert(Incorporations.SwapperNotSet.selector);
        i2.sellForETH(c2, 1, 0);
        // COMD trades work without a venue
        vm.startPrank(alice);
        comd.approve(address(i2), type(uint256).max);
        uint256 got = i2.buyWithComd(c2, 1_000e18, 1);
        vm.stopPrank();
        assertGt(got, 0);
        vm.prank(alice);
        vm.expectRevert();
        i2.setSwapper(address(swapper));
        vm.expectEmit(false, false, false, true, address(i2));
        emit Incorporations.SwapperSet(address(swapper));
        vm.prank(admin);
        i2.setSwapper(address(swapper));
        assertEq(comd.allowance(address(i2), address(swapper)), type(uint256).max);
        vm.prank(bob);
        assertGt(i2.buyWithETH{value: 1 ether}(c2, 1), 0);
        // re-pointing revokes the old approval
        vm.prank(admin);
        i2.setSwapper(address(0));
        assertEq(comd.allowance(address(i2), address(swapper)), 0);
    }

    /// ETH paths through the real (hookless) v4 pool.
    function test_buySellWithEthViaRealPool() public {
        setUpV4Pool();
        useV4Swapper();
        vm.deal(bob, 10 ether);
        vm.prank(bob);
        uint256 out = inc.buyWithETH{value: 0.2 ether}(coin, 1);
        assertGt(out, 0);
        assertEq(inc.launcherEthOwed(launcher), 0.001 ether);
        vm.startPrank(bob);
        IERC20(coin).approve(address(inc), out);
        uint256 ethOut = inc.sellForETH(coin, out, 1);
        vm.stopPrank();
        // pool fee 0.3% + impact both ways, curve 1.5% + 1.5%, launcher 0.5% + 0.5%
        assertLt(ethOut, 0.195 ether);
        assertGt(ethOut, 0.17 ether);
        assertEq(comd.balanceOf(address(inc)), inc.totalBacking());
        assertEq(address(inc).balance, inc.launcherEthOwed(launcher));
    }

    function test_sharedBackingIsolatedPerCoin() public {
        vm.prank(bob);
        address coin2 = inc.create("Beta Partners", "BETA", "");
        vm.startPrank(alice);
        IERC20(coin2).approve(address(inc), type(uint256).max);
        uint256 a = inc.buyWithComd(coin, 50_000e18, 0);
        uint256 b = inc.buyWithComd(coin2, 20_000e18, 0);
        vm.stopPrank();
        assertEq(inc.totalBacking(), inc.coinInfo(coin).comdReserve + inc.coinInfo(coin2).comdReserve);
        assertGe(comd.balanceOf(address(inc)), inc.totalBacking());
        // dumping all of coin2 cannot touch coin's backing
        vm.prank(alice);
        uint256 back2 = inc.sellForComd(coin2, b, 0);
        assertLe(back2, 20_000e18);
        assertEq(inc.coinInfo(coin).comdReserve, 49_000e18);
        assertGe(comd.balanceOf(address(inc)), inc.totalBacking());
        a;
    }

    function testFuzz_noProfitRoundTripAndSolvent(uint256 x, uint256 y) public {
        x = bound(x, 1e15, 500_000e18);
        y = bound(y, 1e15, 400_000e18);
        vm.startPrank(alice);
        uint256 o1 = inc.buyWithComd(coin, x, 0);
        vm.stopPrank();
        comd.transfer(bob, y);
        vm.startPrank(bob);
        comd.approve(address(inc), y);
        uint256 o2 = inc.buyWithComd(coin, y, 0);
        IERC20(coin).approve(address(inc), o2);
        uint256 b2 = inc.sellForComd(coin, o2, 0);
        vm.stopPrank();
        vm.prank(alice);
        uint256 b1 = inc.sellForComd(coin, o1, 0);
        assertLe(b1, x);
        assertLe(b2, y);
        assertGe(comd.balanceOf(address(inc)), inc.totalBacking());
    }

    function test_virtualComdBounds() public {
        vm.startPrank(admin);
        vm.expectRevert(Incorporations.OutOfBounds.selector);
        inc.setVirtualComd(1e18);
        inc.setVirtualComd(50_000e18);
        vm.stopPrank();
        address c2 = inc.create("Gamma", "G", "");
        assertEq(inc.coinInfo(c2).virtualComd, 50_000e18);
        assertEq(inc.coinInfo(coin).virtualComd, 100_000e18, "existing coins unchanged");
    }
}
