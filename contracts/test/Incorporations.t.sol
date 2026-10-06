// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Base} from "./utils/Base.sol";
import {Incorporations, IComdRouterSwaps, IRewardDripperLike} from "../src/Incorporations.sol";

contract IncorporationsTest is Base {
    Incorporations inc;
    address launcher = makeAddr("launcher");
    address coin;

    function setUp() public {
        setUpSystem();
        initSeedAndTrade();
        inc = new Incorporations(
            ERC20Burnable(address(comd)), IComdRouterSwaps(address(router)), IRewardDripperLike(address(dripper)), admin
        );
        vm.prank(launcher);
        coin = inc.create("Acme Litigation Co", "ACME", "https://api.example/coins/acme.json");
        deal(address(comd), alice, 10_000_000e18);
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
        // spot = 100k / 1B = 0.0001 COMPANY per coin
        assertEq(inc.spotPrice(coin), 1e14);
        vm.expectRevert(Incorporations.EmptyName.selector);
        inc.create("", "X", "");
    }

    function test_createEmitsEvent() public {
        vm.expectEmit(false, true, false, true);
        emit Incorporations.CoinCreated(address(0), bob, "Bob LLP", "BOB", "ipfs-free://bob");
        vm.prank(bob);
        inc.create("Bob LLP", "BOB", "ipfs-free://bob");
    }

    function test_buySellWithComdFees() public {
        uint256 supply0 = comd.totalSupply();
        uint256 rew0 = comd.balanceOf(address(dripper));
        uint256 q = inc.quoteBuy(coin, 10_000e18);
        vm.expectEmit(true, true, false, true);
        emit Incorporations.Trade(coin, alice, true, 10_000e18, q, 0);
        vm.prank(alice);
        uint256 out = inc.buyWithComd(coin, 10_000e18, q);
        assertEq(out, q);
        assertEq(IERC20(coin).balanceOf(alice), out);
        assertEq(comd.balanceOf(address(dripper)) - rew0, 100e18, "1% to sCOMD stakers");
        assertEq(supply0 - comd.totalSupply(), 50e18, "0.5% burned");
        assertEq(comd.balanceOf(launcher), 50e18, "0.5% launcher in COMPANY");
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

    function test_buySellWithEth() public {
        vm.deal(bob, 10 ether);
        uint256 supply0 = comd.totalSupply();
        uint256 taxed0 = hook.totalTaxed();
        vm.prank(bob);
        uint256 out = inc.buyWithETH{value: 1 ether}(coin, 1);
        assertGt(out, 0);
        assertEq(IERC20(coin).balanceOf(bob), out);
        assertEq(inc.launcherEthOwed(launcher), 0.005 ether, "0.5% of the ETH side");
        assertEq(comd.balanceOf(launcher), 0, "no COMD launcher fee on ETH trades");
        assertGt(supply0 - comd.totalSupply(), 0, "0.5% COMD burned");

        vm.startPrank(bob);
        IERC20(coin).approve(address(inc), out);
        uint256 before = bob.balance;
        uint256 ethOut = inc.sellForETH(coin, out, 1);
        vm.stopPrank();
        assertEq(bob.balance - before, ethOut);
        // ETH legs pay the pool's 5% tax both ways (+ 2% + 2% curve fees, 0.5% + 0.5% launcher)
        // ≈ 0.995 · 0.95 · 0.985 · 0.985 · 0.95 · 0.995 ≈ 0.869
        assertLt(ethOut, 0.875 ether);
        assertGt(ethOut, 0.86 ether);
        // buy tax: 5% of 0.995 ETH; sell tax: 5% of the gross ETH out (ethOut = 0.995 · 0.95 · gross)
        uint256 sellGross = ethOut * 1e8 / (9_950 * 9_500);
        assertApproxEqAbs(hook.totalTaxed() - taxed0, 0.04975 ether + sellGross * 500 / 10_000, 1e12);
        assertGt(inc.launcherEthOwed(launcher), 0.005 ether);

        uint256 owed = inc.launcherEthOwed(launcher);
        vm.prank(launcher);
        inc.claimLauncherEth();
        assertEq(launcher.balance, owed);
        assertEq(inc.launcherEthOwed(launcher), 0);
    }

    function test_ethSlippage() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert();
        inc.buyWithETH{value: 1 ether}(coin, type(uint256).max);
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
        deal(address(comd), bob, y);
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
