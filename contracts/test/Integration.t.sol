// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC8004Identity, IERC8004Reputation} from "../src/interfaces/IERC8004.sol";

import {Deploy} from "../script/Deploy.s.sol";
import {SeedPool} from "../script/SeedPool.s.sol";
import {ComdToken} from "../src/ComdToken.sol";
import {CounselNFT} from "../src/CounselNFT.sol";
import {RewardDistributor} from "../src/RewardDistributor.sol";
import {RevenueRouter} from "../src/RevenueRouter.sol";
import {Flywheel} from "../src/Flywheel.sol";
import {ComdTaxHook} from "../src/ComdTaxHook.sol";
import {BuyWall} from "../src/BuyWall.sol";
import {ComdRouter} from "../src/ComdRouter.sol";
import {StakedComd} from "../src/StakedComd.sol";
import {RewardDripper} from "../src/RewardDripper.sol";
import {Bond} from "../src/Bond.sol";
import {Incorporations} from "../src/Incorporations.sol";
import {ProjectFactory} from "../src/launch/ProjectFactory.sol";
import {ContributorDistributor} from "../src/launch/ContributorDistributor.sol";
import {MockMarketplace} from "../src/mocks/MockMarketplace.sol";
import {MerkleHelper} from "./utils/MerkleHelper.sol";

/// @notice Whole Company.md system from the deploy + seed scripts on a local v4 PoolManager, end to end:
///         100% liquidity seed → taxed swaps + trims → flywheel buyback/sweep → buy wall post/fill/rebalance →
///         stake/drip → bond for ETH → COMD job revenue split → seat claims (COMD from trims + revenue) →
///         launch + contributor claims → Incorporations.
contract IntegrationTest is Test, MerkleHelper {
    Deploy.Deployment d;
    Deploy.Config c;
    SeedPool seeder;

    ComdToken comd;
    CounselNFT counsel;
    IERC8004Identity identity;
    IERC8004Reputation reputation;
    RewardDistributor distributor;
    RevenueRouter revenue;
    Flywheel flywheel;
    ComdTaxHook hook;
    BuyWall wall;
    ComdRouter router;
    StakedComd vault;
    RewardDripper dripper;
    Bond bond;
    ProjectFactory factory;
    ContributorDistributor contributors;
    Incorporations inc;
    MockMarketplace market;

    address alice = makeAddr("alice"); // Counsel holder running an agent; staker
    address bob = makeAddr("bob"); // trader
    address carol = makeAddr("carol"); // job payer / bond buyer / launch payer
    address platform = makeAddr("platform");

    function setUp() public {
        vm.chainId(31337);
        Deploy script = new Deploy();
        seeder = new SeedPool();
        c.deployer = address(script);
        c.admin = makeAddr("admin");
        c.treasury = makeAddr("treasury");
        c.pol = address(seeder);
        c.settler = makeAddr("settler");
        c.keeper = makeAddr("keeper");
        c.registrar = makeAddr("registrar");
        c.maxSweepPrice = 0.5 ether;
        c.bondPriceEth = 1e10; // wei per 1e18 COMD
        c.counselBaseURI = "https://api.comd.fun/agents/by-token/";
        d = script.deploy(c);

        comd = ComdToken(d.comd);
        counsel = CounselNFT(d.counsel);
        identity = IERC8004Identity(d.identityRegistry);
        reputation = IERC8004Reputation(d.reputationRegistry);
        distributor = RewardDistributor(payable(d.rewardDistributor));
        revenue = RevenueRouter(d.revenueRouter);
        flywheel = Flywheel(payable(d.flywheel));
        hook = ComdTaxHook(payable(d.hook));
        wall = BuyWall(payable(d.buyWall));
        router = ComdRouter(payable(d.router));
        vault = StakedComd(d.stakedComd);
        dripper = RewardDripper(d.rewardDripper);
        bond = Bond(d.bond);
        factory = ProjectFactory(d.projectFactory);
        contributors = ContributorDistributor(d.contributorDistributor);
        inc = Incorporations(payable(d.incorporations));
        market = MockMarketplace(d.mockMarketplace);
        vm.startPrank(c.admin);
        hook.acceptOwnership();
        flywheel.acceptOwnership();
        vm.stopPrank();
    }

    function _conserved() internal view {
        (uint256 b, uint256 s) = flywheel.bucketBalances();
        assertEq(flywheel.totalTaxIn(), b + s + flywheel.totalBoughtBack() + flywheel.sweepSpent(), "tax conservation");
        assertEq(hook.totalTaxed(), flywheel.totalTaxIn() + hook.pendingTax());
        ComdTaxHook.Stats memory st = hook.stats();
        assertEq(st.burned + st.toBond + st.toStakers + st.toSeats, st.split, "split conservation");
        assertEq(st.trimmedComd + wall.totalWallBought(), st.split + hook.claimComd());
    }

    function _buy(address who, uint256 eth) internal returns (uint256) {
        vm.deal(who, who.balance + eth);
        vm.prank(who);
        return router.swapExactETHForComd{value: eth}(0, who, block.timestamp);
    }

    function _sell(address who, uint256 amt) internal returns (uint256 out) {
        vm.startPrank(who);
        comd.approve(d.router, amt);
        out = router.swapExactComdForETH(amt, 0, who, block.timestamp);
        vm.stopPrank();
    }

    function test_endToEnd() public {
        // 1. open the market: 100% of COMD, single-sided, 10 ETH opening market cap; cap = seeded inventory
        seeder.seed(hook, 10 ether, comd.balanceOf(address(seeder)));
        assertEq(hook.cap(), hook.inventory());

        // 2. a seat: free mint, ERC-8004 registration, reputation
        vm.prank(c.admin);
        counsel.setPhase(2);
        vm.prank(alice);
        counsel.mint(2); // ids 1, 2
        string memory uri = counsel.tokenURI(1);
        vm.prank(alice);
        uint256 agentId = identity.register(uri);
        vm.prank(platform);
        reputation.giveFeedback(agentId, 100, 0, "job", "accepted", "", "https://api.comd.fun/reviews/0x1.json", bytes32(0));

        // 3. taxed trading (a holder who stays in, then bob)
        _buy(makeAddr("holder"), 3 ether);
        uint256 bought = _buy(bob, 5 ether);
        if (hook.pendingTax() > 0) hook.flush();
        assertEq(flywheel.totalTaxIn(), 0.4 ether);

        // 4. trims: the cap decays (fast decay for the test), bob sells back → excess trimmed and split
        ComdTaxHook.Params memory p = hook.params();
        p.capDecayPerDay = 1_000_000e18;
        vm.prank(c.admin);
        hook.setParams(p);
        vm.warp(block.timestamp + 300 days);
        vm.roll(block.number + 1);
        _sell(bob, bought);
        ComdTaxHook.Stats memory st = hook.stats();
        assertGt(st.trimmedComd, 10_000_000e18, "trimmed");
        assertGt(comd.balanceOf(d.bond), 0);
        assertGt(comd.balanceOf(d.rewardDripper), 0);
        uint256 seatsComd = comd.balanceOf(d.rewardDistributor);
        assertEq(seatsComd, st.toSeats);
        assertGt(address(wall).balance + hook.claimEth(), 0.1 ether, "trim ETH for the wall");
        _conserved();

        // 5. flywheel: untaxed buyback-and-burn, floor sweep
        uint256 supply0 = comd.totalSupply();
        uint256 taxed0 = hook.totalTaxed();
        vm.prank(c.keeper);
        uint256 burned = flywheel.buyback(1);
        assertEq(supply0 - comd.totalSupply(), burned + (hook.stats().burned - st.burned));
        assertEq(hook.totalTaxed(), taxed0, "buyback untaxed");
        vm.startPrank(alice);
        counsel.setApprovalForAll(d.mockMarketplace, true);
        market.list(d.counsel, 2, 0.05 ether);
        vm.stopPrank();
        vm.prank(c.keeper);
        flywheel.sweep(d.mockMarketplace, "", 2, 0.1 ether);
        assertEq(counsel.ownerOf(2), d.flywheel);
        vm.prank(c.admin);
        flywheel.awardSwept(2, carol);
        _conserved();

        // 6. buy wall: post, fill, rebalance
        vm.roll(block.number + 1);
        vm.prank(c.keeper);
        wall.rebalance();
        assertGt(wall.wallLiquidity(), 0, "wall posted");
        assertGt(wall.wallLower(), int24(0));
        deal(d.comd, bob, 980_000_000e18);
        _sell(bob, 980_000_000e18); // dump through the wall
        (, uint256 filled) = wall.wallAmounts(_sqrtP());
        assertGt(filled, 0, "wall bought COMD");
        vm.roll(block.number + 1);
        vm.prank(c.keeper);
        wall.rebalance();
        assertGt(wall.totalWallBought(), 0);
        _conserved();

        // 7. stake and drip
        deal(d.comd, alice, 1_000_000e18);
        vm.startPrank(alice);
        comd.approve(d.stakedComd, 1_000_000e18);
        uint256 shares = vault.deposit(1_000_000e18, alice);
        vm.stopPrank();
        uint256 px0 = vault.convertToAssets(shares);
        vm.warp(block.timestamp + 1 hours);
        assertGt(dripper.drip(), 0);
        assertGt(vault.convertToAssets(shares), px0, "share value grew");

        // 8. bond: reserve COMD for ETH at the owner price, proceeds to the treasury
        vm.prank(c.admin);
        bond.setEnabled(true);
        assertGe(bond.reserve(), 10_000e18, "bond reserve filled by trims");
        uint256 tEth0 = c.treasury.balance;
        vm.deal(carol, carol.balance + 1 ether);
        vm.prank(carol);
        uint256 bondOut = bond.buyWithEth{value: 0.0001 ether}(1);
        assertEq(bondOut, 10_000e18); // 1e14 wei / 1e10 wei per COMD
        assertEq(c.treasury.balance - tEth0, 0.0001 ether);

        // 9. job revenue in COMD: 80% Counsel rewards / 20% treasury
        uint256 unalloc0 = distributor.unallocated(d.comd);
        uint256 tComd0 = comd.balanceOf(c.treasury);
        vm.prank(carol);
        comd.transfer(d.revenueRouter, 5_000e18); // what the x402 settlement does
        (uint256 toR, uint256 toT) = revenue.distribute();
        assertEq(toR, 4_000e18);
        assertEq(toT, 1_000e18);
        assertEq(distributor.unallocated(d.comd) - unalloc0, 4_000e18);
        assertEq(comd.balanceOf(c.treasury) - tComd0, 1_000e18);

        // 10. Counsel epoch: COMD (trims + job revenue), paid to the current seat owners
        uint256 comdPool = distributor.unallocated(d.comd);
        bytes32[] memory lc = new bytes32[](2);
        lc[0] = _seatLeaf(1, 1, comdPool / 2);
        lc[1] = _seatLeaf(1, 2, comdPool - comdPool / 2);
        vm.prank(c.settler);
        distributor.postRoot(1, d.comd, _root(lc), comdPool);
        uint256 a0 = comd.balanceOf(alice);
        uint256 c0 = comd.balanceOf(carol);
        distributor.claim(1, 1, comdPool / 2, _proof(lc, 0));
        distributor.claim(1, 2, comdPool - comdPool / 2, _proof(lc, 1)); // seat #2 now belongs to carol
        assertEq(comd.balanceOf(alice) - a0, comdPool / 2);
        assertEq(comd.balanceOf(carol) - c0, comdPool - comdPool / 2);
        assertEq(distributor.unallocated(d.comd), 0);

        // 11. launch a custom_token paired with COMD; contributors claim after the lock
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

        // 12. Incorporations: 1% to stakers via the dripper
        vm.prank(carol);
        address coin = inc.create("Carol & Partners", "CNP", "https://api.comd.fun/coins/cnp.json");
        deal(d.comd, carol, 1_000e18);
        vm.startPrank(carol);
        comd.approve(d.incorporations, 1_000e18);
        uint256 got = inc.buyWithComd(coin, 1_000e18, 1);
        vm.stopPrank();
        assertGt(got, 0);
        assertEq(inc.totalToStakers(), 10e18, "1% to stakers via the dripper");
        assertGe(comd.balanceOf(d.incorporations), inc.totalBacking());
        _conserved();
    }

    function _sqrtP() internal view returns (uint160 p) {
        (p,) = hook.slot0();
    }
}
