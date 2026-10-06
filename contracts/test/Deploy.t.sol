// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC8004Identity, IERC8004Reputation} from "../src/interfaces/IERC8004.sol";

import {Deploy} from "../script/Deploy.s.sol";
import {MockComd} from "../src/mocks/MockComd.sol";
import {CounselNFT} from "../src/CounselNFT.sol";
import {Flywheel} from "../src/Flywheel.sol";
import {UniswapV4PoolSwapper} from "../src/swap/UniswapV4PoolSwapper.sol";
import {Incorporations} from "../src/Incorporations.sol";
import {RewardDistributor} from "../src/RewardDistributor.sol";
import {RevenueRouter} from "../src/RevenueRouter.sol";
import {ProjectFactory} from "../src/launch/ProjectFactory.sol";
import {LaunchGuardHook} from "../src/launch/LaunchGuardHook.sol";
import {SeaportAdapter} from "../src/marketplace/SeaportAdapter.sol";
import {ContributorDistributor} from "../src/launch/ContributorDistributor.sol";
import {CounselNFTV2Mock} from "./mocks/CounselNFTV2Mock.sol";

contract DeployTest is Test {
    Deploy script;
    Deploy.Config c;

    function setUp() public {
        script = new Deploy();
        c.deployer = address(script); // in tests the script contract itself makes every call
        c.admin = makeAddr("admin");
        c.treasury = makeAddr("treasury");
        c.settler = makeAddr("settler");
        c.keeper = makeAddr("keeper");
        c.registrar = makeAddr("registrar");
        c.maxSweepPrice = 0.5 ether;
        c.counselBaseURI = "https://api.comd.fun/agents/by-token/";
    }

    function test_mintStageThenFullReusesSeatsAndRegistries() public {
        vm.chainId(46630);
        c.mintOnly = true;
        Deploy.Deployment memory m = script.deploy(c);
        assertTrue(m.counsel != address(0) && m.identityRegistry != address(0) && m.reputationRegistry != address(0));
        assertEq(m.comd, address(0), "mint stage deploys no token");
        assertEq(m.flywheel, address(0));
        assertEq(m.projectFactory, address(0));
        assertEq(CounselNFT(m.counsel).owner(), c.admin);
        assertEq(CounselNFT(m.counsel).contractURI(), "https://api.comd.fun/agents/by-token/collection.json");
        assertTrue(m.counselImpl != address(0) && m.counselImpl != m.counsel, "impl + proxy");
        // seats minted in the mint stage survive the full stage (same proxy)
        vm.prank(c.admin);
        CounselNFT(m.counsel).reserveMint(makeAddr("founder"), 2);
        // the full stage later reuses them
        c.mintOnly = false;
        c.counsel = m.counsel;
        c.identityRegistry = m.identityRegistry;
        c.reputationRegistry = m.reputationRegistry;
        Deploy.Deployment memory d = script.deploy(c);
        assertEq(d.counsel, m.counsel);
        assertEq(d.counselImpl, m.counselImpl, "implementation read back through the proxy");
        assertEq(CounselNFT(d.counsel).ownerOf(1), makeAddr("founder"));
        assertEq(d.identityRegistry, m.identityRegistry);
        assertEq(d.reputationRegistry, m.reputationRegistry);
        assertTrue(d.flywheel != address(0) && d.comd != address(0));
        assertEq(address(Flywheel(payable(d.flywheel)).counsel()), m.counsel);
        string memory json = script.toJson(c, d);
        assertEq(vm.parseJsonString(json, ".stage"), "full");
        assertEq(vm.parseJsonAddress(json, ".counselNFTImpl"), m.counselImpl);
        // a non-proxy COUNSEL_NFT is refused
        c.counsel = address(new CounselNFT()); // a bare implementation: implementation() reads an empty slot
        vm.expectRevert(bytes("COUNSEL_NFT is not an ERC1967 proxy"));
        script.deploy(c);
    }

    function test_counselNftIsUpgradeableProxyOwnedByAdmin() public {
        vm.chainId(46630);
        Deploy.Deployment memory d = script.deploy(c);
        CounselNFT nft = CounselNFT(d.counsel);
        address slot = address(uint160(uint256(vm.load(d.counsel, ERC1967Utils.IMPLEMENTATION_SLOT))));
        assertEq(slot, d.counselImpl, "ERC-1967 implementation slot");
        assertEq(nft.implementation(), d.counselImpl);
        assertEq(nft.owner(), c.admin);
        assertEq(nft.name(), "Counsel");
        assertEq(nft.symbol(), "COUNSEL");
        assertEq(nft.treasury(), c.treasury);
        (address r, uint256 amt) = nft.royaltyInfo(1, 1 ether);
        assertEq(r, c.treasury);
        assertEq(amt, 0.05 ether);
        // the implementation is locked
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        CounselNFT(d.counselImpl).initialize(address(this), "x", address(this));
        // deployer cannot upgrade, admin can
        CounselNFTV2Mock v2 = new CounselNFTV2Mock();
        vm.prank(address(script));
        vm.expectRevert();
        nft.upgradeToAndCall(address(v2), "");
        vm.prank(c.admin);
        nft.upgradeToAndCall(address(v2), "");
        assertEq(nft.implementation(), address(v2));
        assertEq(CounselNFTV2Mock(d.counsel).version(), 2);
    }

    function test_allowEthPairingOptIn() public {
        vm.chainId(46630);
        c.allowEthPairing = true;
        Deploy.Deployment memory d = script.deploy(c);
        ProjectFactory f = ProjectFactory(d.projectFactory);
        (bool ok, uint256 mn, uint256 mx) = f.pairedConfig(address(0));
        assertTrue(ok);
        assertEq(mn, 1 ether);
        assertEq(mx, 1_000 ether);
        (ok,,) = f.pairedConfig(d.comd);
        assertTrue(ok);
    }

    /// V7 D: after the script, the deployer holds no owner role, pending ownership, admin role or hot-wallet role
    /// on any contract; everything is ADMIN's (or the designated hot wallet's).
    function test_noDeployerPowersRemain() public {
        vm.chainId(31337);
        Deploy.Deployment memory local = script.deploy(c);
        vm.chainId(4663);
        c.poolManager = local.poolManager;
        c.comd = local.comd;
        c.seaport = makeAddr("seaport");
        Deploy.Deployment memory d = script.deploy(c);
        address dep = address(script);
        assertTrue(dep != c.admin, "test precondition: ADMIN differs from the deployer");

        // Ownable2Step contracts: owner == ADMIN, nothing pending
        assertEq(CounselNFT(d.counsel).owner(), c.admin);
        assertEq(CounselNFT(d.counsel).pendingOwner(), address(0));
        Flywheel fw = Flywheel(payable(d.flywheel));
        assertEq(fw.owner(), c.admin);
        assertEq(fw.pendingOwner(), address(0));
        assertTrue(fw.keeper() != dep);
        UniswapV4PoolSwapper sw = UniswapV4PoolSwapper(payable(d.swapper));
        assertEq(sw.owner(), c.admin);
        assertEq(sw.pendingOwner(), address(0));
        RevenueRouter rr = RevenueRouter(d.revenueRouter);
        assertEq(rr.owner(), c.admin);
        assertEq(rr.pendingOwner(), address(0));
        Incorporations inc = Incorporations(payable(d.incorporations));
        assertEq(inc.owner(), c.admin);
        assertEq(inc.pendingOwner(), address(0));
        SeaportAdapter sa = SeaportAdapter(payable(d.seaportAdapter));
        assertEq(sa.owner(), c.admin);
        assertEq(sa.pendingOwner(), address(0));
        // AccessControl contracts: ADMIN has the admin role, the deployer has none
        RewardDistributor dist = RewardDistributor(payable(d.rewardDistributor));
        assertTrue(dist.hasRole(0x00, c.admin));
        assertFalse(dist.hasRole(0x00, dep));
        assertFalse(dist.hasRole(dist.SETTLER_ROLE(), dep));
        assertTrue(dist.hasRole(dist.SETTLER_ROLE(), c.settler));
        ProjectFactory f = ProjectFactory(d.projectFactory);
        assertTrue(f.hasRole(0x00, c.admin));
        assertFalse(f.hasRole(0x00, dep));
        assertFalse(f.hasRole(f.REGISTRAR_ROLE(), dep));
        assertTrue(f.hasRole(f.REGISTRAR_ROLE(), c.registrar));
        // UUPS registries: owner == ADMIN; the deployer cannot upgrade them
        assertEq(IERC8004Identity(d.identityRegistry).owner(), c.admin);
        assertEq(IERC8004Reputation(d.reputationRegistry).owner(), c.admin);
        vm.prank(dep);
        vm.expectRevert();
        IERC8004Identity(d.identityRegistry).upgradeToAndCall(d.identityImpl, "");
        vm.prank(dep);
        vm.expectRevert();
        IERC8004Identity(d.reputationRegistry).upgradeToAndCall(d.reputationImpl, "");
        vm.prank(dep);
        vm.expectRevert();
        CounselNFT(d.counsel).upgradeToAndCall(d.counselImpl, "");
        // ownerless plumbing: distributor answers only to the factory, hook only to the factory admin
        assertEq(ContributorDistributor(d.contributorDistributor).factory(), d.projectFactory);
        assertEq(LaunchGuardHook(d.launchGuardHook).factory(), d.projectFactory);
        // the deployer cannot pause or rescue anything
        vm.startPrank(dep);
        vm.expectRevert();
        fw.pause();
        vm.expectRevert();
        rr.pause();
        vm.expectRevert();
        inc.pause();
        vm.expectRevert();
        dist.pause();
        vm.expectRevert();
        f.pause();
        vm.expectRevert();
        CounselNFT(d.counsel).setPhase(2);
        vm.stopPrank();
    }

    function test_mintStageNeedsNoComdOnMainnet() public {
        vm.chainId(4663);
        c.mintOnly = true;
        c.poolManager = address(0);
        Deploy.Deployment memory m = script.deploy(c);
        assertTrue(m.counsel != address(0));
        assertEq(m.comd, address(0));
    }

    function test_deployTestChainWithMockComd() public {
        vm.chainId(46630);
        Deploy.Deployment memory d = script.deploy(c);
        assertTrue(d.deployedPoolManager);
        assertTrue(d.deployedMockComd);
        assertTrue(d.mockMarketplace != address(0));
        assertEq(d.seaportAdapter, address(0));

        MockComd t = MockComd(d.comd);
        assertEq(t.totalSupply(), 1_000_000_000e18);
        assertEq(t.decimals(), 18);
        assertEq(t.balanceOf(address(script)), 1_000_000_000e18, "mock supply to the deployer");

        assertEq(uint160(d.launchGuardHook) & Hooks.ALL_HOOK_MASK, uint160(Hooks.BEFORE_INITIALIZE_FLAG));
        Flywheel fw = Flywheel(payable(d.flywheel));
        assertEq(address(fw.comd()), d.comd);
        assertEq(address(fw.counsel()), d.counsel);
        assertEq(address(fw.swapper()), d.swapper);
        assertEq(fw.keeper(), c.keeper);
        assertTrue(fw.adapterAllowed(d.mockMarketplace));
        assertEq(fw.maxSweepPrice(), 0.5 ether);
        // owned by ADMIN from the first block: nothing pending, the deployer never held it
        assertEq(fw.owner(), c.admin);
        assertEq(fw.pendingOwner(), address(0));

        UniswapV4PoolSwapper sw = UniswapV4PoolSwapper(payable(d.swapper));
        assertEq(address(sw.poolManager()), d.poolManager);
        assertEq(address(sw.comd()), d.comd);
        assertEq(sw.owner(), c.admin, "ADMIN configures the pool key after the Pons graduation");
        assertFalse(sw.configured(), "unconfigured until graduation");

        Incorporations inc = Incorporations(payable(d.incorporations));
        assertEq(address(inc.comd()), d.comd);
        assertEq(inc.rewardDistributor(), d.rewardDistributor);
        assertEq(address(inc.swapper()), d.swapper);
        assertEq(inc.owner(), c.admin);

        assertEq(RevenueRouter(d.revenueRouter).owner(), c.admin);
        assertEq(RevenueRouter(d.revenueRouter).rewardDistributor(), d.rewardDistributor);
        assertEq(address(RevenueRouter(d.revenueRouter).comd()), d.comd);
        assertEq(RevenueRouter(d.revenueRouter).treasury(), c.treasury);

        RewardDistributor dist = RewardDistributor(payable(d.rewardDistributor));
        assertEq(address(dist.comd()), d.comd);
        assertTrue(dist.hasRole(0x00, c.admin));
        assertFalse(dist.hasRole(0x00, address(script)));
        assertTrue(dist.hasRole(dist.SETTLER_ROLE(), c.settler));
        ProjectFactory f = ProjectFactory(d.projectFactory);
        assertTrue(f.hasRole(f.REGISTRAR_ROLE(), c.registrar));
        assertFalse(f.hasRole(0x00, address(script)));
        (bool ok, uint256 mn, uint256 mx) = f.pairedConfig(d.comd);
        assertTrue(ok, "COMD pairing allowed");
        assertEq(mn, 100_000e18);
        assertEq(mx, 100_000_000e18);
        (ok,,) = f.pairedConfig(address(0));
        assertFalse(ok, "ETH pairing off by default (ALLOW_ETH_PAIRING)");
        assertEq(LaunchGuardHook(d.launchGuardHook).factory(), d.projectFactory);

        assertEq(IERC8004Identity(d.identityRegistry).owner(), c.admin);
        assertEq(IERC8004Reputation(d.reputationRegistry).getIdentityRegistry(), d.identityRegistry);

        // the Flywheel accepts ETH right away; buybacks wait for the swapper's pool key
        vm.deal(makeAddr("pons"), 1 ether);
        vm.prank(makeAddr("pons"));
        (bool sent,) = d.flywheel.call{value: 1 ether}("");
        assertTrue(sent);
        (uint256 b, uint256 s) = fw.bucketBalances();
        assertEq(b, 0.5 ether);
        assertEq(s, 0.5 ether);
        vm.prank(c.keeper);
        vm.expectRevert(UniswapV4PoolSwapper.PoolNotSet.selector);
        fw.buyback(0);
    }

    function test_mainnetRequiresComdTokenAndPoolManager() public {
        vm.chainId(4663);
        c.comd = address(0);
        c.poolManager = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
        vm.expectRevert(bytes("COMD_TOKEN required on this chain: set it to the Pons $COMD token address"));
        script.deploy(c);
        c.comd = makeAddr("no-code");
        vm.expectRevert(bytes("COMD_TOKEN has no code"));
        script.deploy(c);
        c.comd = address(new MockComd());
        vm.expectRevert(bytes("PoolManager has no code"));
        script.deploy(c);
        c.poolManager = address(0);
        vm.expectRevert(bytes("POOL_MANAGER required on this chain"));
        script.deploy(c);
        // unknown chain ids are treated as real chains too
        vm.chainId(999_999);
        c.comd = address(0);
        vm.expectRevert(bytes("COMD_TOKEN required on this chain: set it to the Pons $COMD token address"));
        script.deploy(c);
    }

    function test_mainnetWithExternalsNoMocks() public {
        vm.chainId(31337);
        Deploy.Deployment memory local = script.deploy(c); // deploys a PoolManager + MockComd we can reuse
        assertTrue(local.deployedMockComd);
        vm.chainId(4663);
        c.poolManager = local.poolManager;
        c.comd = local.comd; // stands in for the Pons token
        c.seaport = makeAddr("seaport");
        Deploy.Deployment memory d = script.deploy(c);
        assertFalse(d.deployedPoolManager);
        assertFalse(d.deployedMockComd);
        assertEq(d.comd, local.comd, "external token used as is");
        assertEq(d.mockMarketplace, address(0), "no mock marketplace on mainnet");
        assertTrue(d.seaportAdapter != address(0));
        assertTrue(Flywheel(payable(d.flywheel)).adapterAllowed(d.seaportAdapter));
        assertEq(IERC20Metadata(d.comd).decimals(), 18);
    }

    function test_configFromEnvDefaults() public {
        vm.chainId(4663);
        Deploy.Config memory e = script.configFromEnv(address(0xBEEF));
        assertEq(e.admin, address(0xBEEF));
        assertEq(e.treasury, address(0xBEEF));
        assertEq(e.keeper, address(0xBEEF));
        assertEq(e.comd, address(0), "COMD_TOKEN unset in this test env");
        assertEq(e.poolManager, 0x8366a39CC670B4001A1121B8F6A443A643e40951);
        assertEq(e.maxSweepPrice, 0.5 ether);
        assertFalse(e.allowEthPairing, "ALLOW_ETH_PAIRING defaults to false: $COMD is the only pairing");
        vm.chainId(46630);
        e = script.configFromEnv(address(0xBEEF));
        assertEq(e.poolManager, address(0));
    }

    function test_deploymentsJsonPrintedForCi() public {
        vm.chainId(46630);
        Deploy.Deployment memory d = script.deploy(c);
        string memory json = script.toJson(c, d);
        assertEq(vm.parseJsonUint(json, ".chainId"), 46630);
        assertEq(vm.parseJsonAddress(json, ".comdToken"), d.comd);
        assertEq(vm.parseJsonAddress(json, ".counselNFT"), d.counsel);
        assertEq(vm.parseJsonAddress(json, ".counselNFTImpl"), d.counselImpl);
        assertEq(vm.parseJsonAddress(json, ".identityRegistry"), d.identityRegistry);
        assertEq(vm.parseJsonAddress(json, ".reputationRegistry"), d.reputationRegistry);
        assertEq(vm.parseJsonAddress(json, ".rewardDistributor"), d.rewardDistributor);
        assertEq(vm.parseJsonAddress(json, ".revenueRouter"), d.revenueRouter);
        assertEq(vm.parseJsonAddress(json, ".flywheel"), d.flywheel);
        assertEq(vm.parseJsonAddress(json, ".swapper"), d.swapper);
        assertEq(vm.parseJsonAddress(json, ".incorporations"), d.incorporations);
        assertEq(vm.parseJsonAddress(json, ".projectFactory"), d.projectFactory);
        assertEq(vm.parseJsonAddress(json, ".contributorDistributor"), d.contributorDistributor);
        assertEq(vm.parseJsonAddress(json, ".launchGuardHook"), d.launchGuardHook);
        assertEq(vm.parseJsonAddress(json, ".create2Deployer"), d.create2Deployer);
        assertEq(vm.parseJsonAddress(json, ".mockMarketplace"), d.mockMarketplace);
        assertEq(vm.parseJsonAddress(json, ".seaportAdapter"), address(0));
        assertEq(vm.parseJsonAddress(json, ".admin"), c.admin);
        assertEq(vm.parseJsonAddress(json, ".treasury"), c.treasury);
        assertEq(vm.parseJsonAddress(json, ".keeper"), c.keeper);
        assertEq(vm.parseJsonAddress(json, ".settler"), c.settler);
        assertEq(vm.parseJsonAddress(json, ".registrar"), c.registrar);
        assertEq(vm.parseJsonAddress(json, ".poolManager"), d.poolManager);
        assertFalse(vm.keyExistsJson(json, ".comdTaxHook"));
        assertFalse(vm.keyExistsJson(json, ".comdRouter"));
        assertFalse(vm.keyExistsJson(json, ".bond"));
        assertFalse(vm.keyExistsJson(json, ".pol"));
    }
}
