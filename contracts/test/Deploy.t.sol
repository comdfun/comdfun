// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IERC8004Identity, IERC8004Reputation} from "../src/interfaces/IERC8004.sol";

import {Deploy} from "../script/Deploy.s.sol";
import {SeedPool} from "../script/SeedPool.s.sol";
import {ComdToken} from "../src/ComdToken.sol";
import {ComdTaxHook} from "../src/ComdTaxHook.sol";
import {ComdRouter} from "../src/ComdRouter.sol";
import {Flywheel} from "../src/Flywheel.sol";
import {RewardDistributor} from "../src/RewardDistributor.sol";
import {RevenueRouter} from "../src/RevenueRouter.sol";
import {ProjectFactory} from "../src/launch/ProjectFactory.sol";
import {BuyWall} from "../src/BuyWall.sol";
import {StakedComd} from "../src/StakedComd.sol";
import {RewardDripper} from "../src/RewardDripper.sol";
import {Bond} from "../src/Bond.sol";
import {LaunchGuardHook} from "../src/launch/LaunchGuardHook.sol";

contract DeployTest is Test {
    Deploy script;
    SeedPool seeder;
    Deploy.Config c;

    function setUp() public {
        script = new Deploy();
        seeder = new SeedPool();
        c.deployer = address(script); // in tests the script contract itself makes every call
        c.admin = makeAddr("admin");
        c.treasury = makeAddr("treasury");
        c.pol = address(seeder); // the SeedPool helper acts as the POL wallet
        c.settler = makeAddr("settler");
        c.keeper = makeAddr("keeper");
        c.registrar = makeAddr("registrar");
        c.maxSweepPrice = 0.5 ether;
        c.bondPriceEth = 1e10;
        c.counselBaseURI = "https://api.comd.fun/agents/by-token/";
    }

    function test_deployAndSeed() public {
        vm.chainId(46630);
        Deploy.Deployment memory d = script.deploy(c);
        assertTrue(d.deployedPoolManager);
        assertTrue(d.mockMarketplace != address(0));
        assertEq(d.seaportAdapter, address(0));

        ComdToken t = ComdToken(d.comd);
        assertEq(t.totalSupply(), 1_000_000_000e18);
        assertEq(t.balanceOf(c.pol), 1_000_000_000e18, "100% to POL");
        assertEq(t.balanceOf(address(script)), 0);

        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
                | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        assertEq(uint160(d.hook) & Hooks.ALL_HOOK_MASK, flags);
        assertEq(uint160(d.launchGuardHook) & Hooks.ALL_HOOK_MASK, uint160(Hooks.BEFORE_INITIALIZE_FLAG));
        ComdTaxHook h = ComdTaxHook(payable(d.hook));
        Flywheel fw = Flywheel(payable(d.flywheel));
        assertEq(h.pol(), c.pol);
        assertEq(address(h.flywheel()), d.flywheel);
        assertEq(h.router(), d.router);
        assertEq(h.buyWall(), d.buyWall);
        assertEq(h.bond(), d.bond);
        assertEq(h.dripper(), d.rewardDripper);
        assertEq(h.distributor(), d.rewardDistributor);
        assertEq(address(BuyWall(payable(d.buyWall)).hook()), d.hook);
        assertEq(BuyWall(payable(d.buyWall)).owner(), c.admin);
        assertEq(RewardDripper(d.rewardDripper).vault(), d.stakedComd);
        assertEq(StakedComd(d.stakedComd).asset(), d.comd);
        assertEq(StakedComd(d.stakedComd).owner(), c.admin);
        assertEq(address(Bond(d.bond).comd()), d.comd);
        assertEq(Bond(d.bond).priceEth(), 1e10);
        assertEq(Bond(d.bond).owner(), c.admin);
        assertEq(Bond(d.bond).treasury(), c.treasury);
        assertFalse(Bond(d.bond).enabled());
        assertEq(fw.hook(), d.hook);
        assertEq(address(fw.router()), d.router);
        assertEq(fw.keeper(), c.keeper);
        assertTrue(fw.adapterAllowed(d.mockMarketplace));
        assertEq(fw.maxSweepPrice(), 0.5 ether);
        // Ownable2Step hand-over: admin accepts
        assertEq(h.pendingOwner(), c.admin);
        assertEq(fw.pendingOwner(), c.admin);
        vm.startPrank(c.admin);
        h.acceptOwnership();
        fw.acceptOwnership();
        vm.stopPrank();
        assertEq(h.owner(), c.admin);
        assertEq(fw.owner(), c.admin);
        assertEq(RevenueRouter(d.revenueRouter).owner(), c.admin);
        assertEq(RevenueRouter(d.revenueRouter).rewardDistributor(), d.rewardDistributor);
        assertEq(address(RevenueRouter(d.revenueRouter).comd()), d.comd);
        assertEq(RevenueRouter(d.revenueRouter).treasury(), c.treasury);

        RewardDistributor dist = RewardDistributor(payable(d.rewardDistributor));
        assertTrue(dist.hasRole(0x00, c.admin));
        assertFalse(dist.hasRole(0x00, address(script)));
        assertTrue(dist.hasRole(dist.SETTLER_ROLE(), c.settler));
        ProjectFactory f = ProjectFactory(d.projectFactory);
        assertTrue(f.hasRole(f.REGISTRAR_ROLE(), c.registrar));
        assertFalse(f.hasRole(0x00, address(script)));
        (bool ok, uint256 mn, uint256 mx) = f.pairedConfig(address(0));
        assertTrue(ok);
        assertEq(mn, 1 ether);
        assertEq(mx, 1_000 ether);
        (ok,,) = f.pairedConfig(d.comd);
        assertTrue(ok, "COMD pairing allowed");
        assertEq(LaunchGuardHook(d.launchGuardHook).factory(), d.projectFactory);

        assertEq(IERC8004Identity(d.identityRegistry).owner(), c.admin);
        assertEq(IERC8004Reputation(d.reputationRegistry).getIdentityRegistry(), d.identityRegistry);

        // SeedPool: one call opens the pool with 100% of supply
        seeder.seed(h, 10 ether, 1_000_000_000e18);
        assertTrue(h.seeded());
        assertEq(h.cap(), h.inventory(), "cap starts at the seeded inventory");
        assertLt(t.balanceOf(c.pol), 1e12, "only rounding dust left");
        vm.deal(makeAddr("buyer"), 1 ether);
        vm.prank(makeAddr("buyer"));
        uint256 out = ComdRouter(payable(d.router)).swapExactETHForComd{value: 1 ether}(0, makeAddr("buyer"), block.timestamp);
        assertGt(out, 0);
    }

    function test_mainnetRequiresPoolManagerCode() public {
        vm.chainId(4663);
        c.poolManager = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
        vm.expectRevert(bytes("PoolManager has no code"));
        script.deploy(c);
        c.poolManager = address(0);
        vm.expectRevert(bytes("POOL_MANAGER required on this chain"));
        script.deploy(c);
    }

    function test_mainnetWithExternalsNoMockMarketplace() public {
        vm.chainId(31337);
        Deploy.Deployment memory local = script.deploy(c); // deploys a PoolManager we can reuse
        vm.chainId(4663);
        c.poolManager = local.poolManager;
        c.seaport = makeAddr("seaport");
        Deploy.Deployment memory d = script.deploy(c);
        assertFalse(d.deployedPoolManager);
        assertEq(d.mockMarketplace, address(0), "no mock marketplace on mainnet");
        assertTrue(d.seaportAdapter != address(0));
        assertTrue(Flywheel(payable(d.flywheel)).adapterAllowed(d.seaportAdapter));
    }

    function test_configFromEnvDefaults() public {
        vm.chainId(4663);
        Deploy.Config memory e = script.configFromEnv(address(0xBEEF));
        assertEq(e.admin, address(0xBEEF));
        assertEq(e.pol, address(0xBEEF));
        assertEq(e.poolManager, 0x8366a39CC670B4001A1121B8F6A443A643e40951);
        assertEq(e.bondPriceEth, 1e10);
        assertEq(e.maxSweepPrice, 0.5 ether);
        vm.chainId(46630);
        e = script.configFromEnv(address(0xBEEF));
        assertEq(e.poolManager, address(0));
    }

    function test_deploymentsJsonPrintedForCi() public {
        vm.chainId(46630);
        Deploy.Deployment memory d = script.deploy(c);
        string memory json = script.toJson(c, d);
        assertEq(vm.parseJsonUint(json, ".chainId"), 46630);
        assertEq(vm.parseJsonAddress(json, ".comdTaxHook"), d.hook);
        assertEq(vm.parseJsonAddress(json, ".bond"), d.bond);
        assertEq(vm.parseJsonAddress(json, ".revenueRouter"), d.revenueRouter);
    }
}
