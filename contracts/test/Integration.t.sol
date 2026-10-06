// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {IERC8004Identity, IERC8004Reputation} from "../src/interfaces/IERC8004.sol";

import {Deploy} from "../script/Deploy.s.sol";
import {MockComd} from "../src/mocks/MockComd.sol";
import {CounselNFT} from "../src/CounselNFT.sol";
import {RewardDistributor} from "../src/RewardDistributor.sol";
import {RevenueRouter} from "../src/RevenueRouter.sol";
import {Flywheel} from "../src/Flywheel.sol";
import {UniswapV4PoolSwapper} from "../src/swap/UniswapV4PoolSwapper.sol";
import {Incorporations} from "../src/Incorporations.sol";
import {ProjectFactory} from "../src/launch/ProjectFactory.sol";
import {ContributorDistributor} from "../src/launch/ContributorDistributor.sol";
import {MockMarketplace} from "../src/mocks/MockMarketplace.sol";
import {MerkleHelper} from "./utils/MerkleHelper.sol";

/// @notice Whole Company.md system from the deploy script on a local v4 PoolManager, Pons mode, end to end:
///         $COMD is an external token (MockComd) whose liquidity sits in a v4 pool we do not own → the owner points
///         the swapper at it → seat mint + ERC-8004 → COMD job revenue 80/20 → seat claims → Pons payout ETH into
///         the Flywheel → buyback to the dead address + floor sweep + award → Incorporations (COMD and ETH legs)
///         → launch + contributor claims.
contract IntegrationTest is Test, MerkleHelper {
    Deploy.Deployment d;
    Deploy.Config c;

    MockComd comd;
    CounselNFT counsel;
    IERC8004Identity identity;
    IERC8004Reputation reputation;
    RewardDistributor distributor;
    RevenueRouter revenue;
    Flywheel flywheel;
    UniswapV4PoolSwapper swapper;
    ProjectFactory factory;
    ContributorDistributor contributors;
    Incorporations inc;
    MockMarketplace market;
    PoolKey poolKey;

    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address alice = makeAddr("alice"); // Counsel holder running an agent
    address bob = makeAddr("bob"); // trader
    address carol = makeAddr("carol"); // job payer / launch payer
    address platform = makeAddr("platform");
    address pons = makeAddr("pons"); // Pons pays the creator wallet in ETH; it is forwarded to the Flywheel

    function setUp() public {
        vm.chainId(31337);
        Deploy script = new Deploy();
        c.deployer = address(script);
        c.admin = makeAddr("admin");
        c.treasury = makeAddr("treasury");
        c.settler = makeAddr("settler");
        c.keeper = makeAddr("keeper");
        c.registrar = makeAddr("registrar");
        c.maxSweepPrice = 0.5 ether;
        c.counselBaseURI = "https://api.comd.fun/agents/by-token/";
        d = script.deploy(c);

        comd = MockComd(d.comd);
        counsel = CounselNFT(d.counsel);
        identity = IERC8004Identity(d.identityRegistry);
        reputation = IERC8004Reputation(d.reputationRegistry);
        distributor = RewardDistributor(payable(d.rewardDistributor));
        revenue = RevenueRouter(d.revenueRouter);
        flywheel = Flywheel(payable(d.flywheel));
        swapper = UniswapV4PoolSwapper(payable(d.swapper));
        factory = ProjectFactory(d.projectFactory);
        contributors = ContributorDistributor(d.contributorDistributor);
        inc = Incorporations(payable(d.incorporations));
        market = MockMarketplace(d.mockMarketplace);
        vm.prank(c.admin);
        flywheel.acceptOwnership();
        // the mock token was minted to the deployer (the script); this test acts as "Pons + the market"
        uint256 supply = comd.totalSupply();
        vm.prank(address(script));
        comd.transfer(address(this), supply);
    }

    function _conserved() internal view {
        (uint256 b, uint256 s) = flywheel.bucketBalances();
        assertEq(flywheel.totalTaxIn(), b + s + flywheel.totalBoughtBack() + flywheel.sweepSpent(), "tax conservation");
        assertEq(address(flywheel).balance, b + s);
        assertEq(comd.balanceOf(address(flywheel)), 0);
        assertEq(comd.balanceOf(DEAD), flywheel.totalBurned() + inc.totalBurned(), "dead address bookkeeping");
    }

    /// Pons graduation stand-in: a hookless ETH/COMD pool (≈ 1e8 COMD per ETH) with ≈ 5 ETH + 5e8 COMD.
    function _graduate() internal {
        IPoolManager pm = IPoolManager(d.poolManager);
        poolKey = PoolKey(Currency.wrap(address(0)), Currency.wrap(d.comd), 3_000, 60, IHooks(address(0)));
        pm.initialize(poolKey, TickMath.getSqrtPriceAtTick(184_200));
        PoolModifyLiquidityTest lp = new PoolModifyLiquidityTest(pm);
        comd.approve(address(lp), type(uint256).max);
        vm.deal(address(this), 10 ether);
        lp.modifyLiquidity{value: 6 ether}(
            poolKey, ModifyLiquidityParams({tickLower: -887_220, tickUpper: 887_220, liquidityDelta: 5e22, salt: 0}), ""
        );
    }

    receive() external payable {}

    function test_endToEnd() public {
        // 1. before graduation: ETH already flows into the Flywheel, buybacks wait
        vm.deal(pons, 10 ether);
        vm.prank(pons);
        (bool ok,) = d.flywheel.call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(flywheel.totalTaxIn(), 1 ether);
        vm.prank(c.keeper);
        vm.expectRevert(UniswapV4PoolSwapper.PoolNotSet.selector);
        flywheel.buyback(0);

        // 2. graduation: the owner points the swapper at the pool
        _graduate();
        vm.prank(c.admin);
        swapper.setPoolKey(3_000, 60, IHooks(address(0)));
        assertTrue(swapper.configured());

        // 3. a seat: free mint, ERC-8004 registration, reputation
        vm.prank(c.admin);
        counsel.setPhase(2);
        vm.prank(alice);
        counsel.mint(2); // ids 1, 2
        string memory uri = counsel.tokenURI(1);
        vm.prank(alice);
        uint256 agentId = identity.register(uri);
        vm.prank(platform);
        reputation.giveFeedback(agentId, 100, 0, "job", "accepted", "", "https://api.comd.fun/reviews/0x1.json", bytes32(0));

        // 4. job revenue in COMD: 80% Counsel rewards / 20% treasury
        comd.transfer(carol, 10_000e18);
        vm.prank(carol);
        comd.transfer(d.revenueRouter, 5_000e18); // what the x402 settlement does
        (uint256 toR, uint256 toT) = revenue.distribute();
        assertEq(toR, 4_000e18);
        assertEq(toT, 1_000e18);
        assertEq(distributor.unallocated(d.comd), 4_000e18);
        assertEq(comd.balanceOf(c.treasury), 1_000e18);

        // 5. Counsel epoch: paid to the current seat owners
        bytes32[] memory lc = new bytes32[](2);
        lc[0] = _seatLeaf(1, 1, 2_500e18);
        lc[1] = _seatLeaf(1, 2, 1_500e18);
        vm.prank(c.settler);
        distributor.postRoot(1, d.comd, _root(lc), 4_000e18);
        distributor.claim(1, 1, 2_500e18, _proof(lc, 0));
        vm.prank(alice);
        counsel.transferFrom(alice, carol, 2); // unclaimed rewards travel with the seat
        distributor.claim(1, 2, 1_500e18, _proof(lc, 1));
        assertEq(comd.balanceOf(alice), 2_500e18);
        assertEq(comd.balanceOf(carol), 10_000e18 - 5_000e18 + 1_500e18);
        assertEq(distributor.unallocated(d.comd), 0);

        // 6. Flywheel: more Pons payouts, buyback through the pool to the dead address, floor sweep, award
        vm.prank(pons);
        flywheel.notifyTax{value: 1 ether}();
        (uint256 b, uint256 s) = flywheel.bucketBalances();
        assertEq(b, 1 ether);
        assertEq(s, 1 ether);
        uint256 q = swapper.quoteETHForComd(1 ether);
        uint256 supply0 = comd.totalSupply();
        vm.prank(c.keeper);
        uint256 burned = flywheel.buyback(q);
        assertEq(burned, q);
        assertEq(comd.totalSupply(), supply0, "external token: no burn(), supply unchanged");
        assertEq(comd.balanceOf(DEAD), burned);
        assertEq(flywheel.totalBurned(), burned);
        assertEq(flywheel.totalBoughtBack(), 1 ether);
        vm.startPrank(alice);
        counsel.setApprovalForAll(d.mockMarketplace, true);
        market.list(d.counsel, 1, 0.05 ether);
        vm.stopPrank();
        vm.prank(c.keeper);
        flywheel.sweep(d.mockMarketplace, "", 1, 0.1 ether);
        assertEq(counsel.ownerOf(1), d.flywheel);
        assertEq(flywheel.sweepSpent(), 0.05 ether);
        vm.prank(c.admin);
        flywheel.awardSwept(1, bob);
        assertEq(counsel.ownerOf(1), bob);
        _conserved();

        // 7. Incorporations: COMD leg (1% to Counsel rewards, 0.5% dead, 0.5% launcher) and ETH legs via the pool
        vm.prank(carol);
        address coin = inc.create("Carol & Partners", "CNP", "https://api.comd.fun/coins/cnp.json");
        vm.startPrank(carol);
        comd.approve(d.incorporations, 1_000e18);
        uint256 got = inc.buyWithComd(coin, 1_000e18, 1);
        vm.stopPrank();
        assertGt(got, 0);
        assertEq(inc.totalToRewards(), 10e18);
        assertEq(distributor.unallocated(d.comd), 10e18, "1% fee claimable by Counsel");
        assertEq(inc.totalBurned(), 5e18);
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        uint256 coins = inc.buyWithETH{value: 0.1 ether}(coin, 1);
        assertGt(coins, 0);
        vm.startPrank(bob);
        IERC20(coin).approve(d.incorporations, coins);
        uint256 ethOut = inc.sellForETH(coin, coins, 1);
        vm.stopPrank();
        assertGt(ethOut, 0.08 ether);
        assertLt(ethOut, 0.1 ether);
        assertGe(comd.balanceOf(d.incorporations), inc.totalBacking());
        assertEq(inc.launcherEthOwed(carol), address(inc).balance);
        _conserved();

        // 8. launch a custom_token paired with COMD; contributors claim after the lock
        uint256 supply = 1_000_000_000e18;
        bytes32[] memory cl = new bytes32[](2);
        cl[0] = _contribLeaf(1, alice, supply * 600 / 10_000);
        cl[1] = _contribLeaf(1, bob, supply * 400 / 10_000);
        ProjectFactory.LaunchParams memory lp;
        lp.kind = 0;
        lp.name = "In re: Widgets";
        lp.symbol = "WIDG";
        lp.paired = d.comd;
        lp.fee = 10_000;
        lp.initialMarketCap = 1_000_000e18;
        lp.poolBps = 8_800;
        lp.remainderTo = carol;
        lp.contributorRoot = _root(cl);
        vm.prank(c.registrar);
        (uint256 launchId, address token) = factory.launch(lp);
        vm.warp(block.timestamp + 1 hours);
        contributors.claim(launchId, alice, supply * 600 / 10_000, _proof(cl, 0));
        assertEq(IERC20(token).balanceOf(alice), supply * 600 / 10_000);
    }
}
