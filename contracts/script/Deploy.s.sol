// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IERC8004Identity, IERC8004Reputation} from "../src/interfaces/IERC8004.sol";

import {MockComd} from "../src/mocks/MockComd.sol";
import {CounselNFT} from "../src/CounselNFT.sol";
import {RewardDistributor} from "../src/RewardDistributor.sol";
import {RevenueRouter} from "../src/RevenueRouter.sol";
import {Flywheel} from "../src/Flywheel.sol";
import {UniswapV4PoolSwapper} from "../src/swap/UniswapV4PoolSwapper.sol";
import {IBuybackSwapper} from "../src/interfaces/IBuybackSwapper.sol";
import {Incorporations} from "../src/Incorporations.sol";
import {ProjectFactory} from "../src/launch/ProjectFactory.sol";
import {LaunchGuardHook} from "../src/launch/LaunchGuardHook.sol";
import {ERC8004Bootstrap} from "../src/ERC8004Bootstrap.sol";
import {Create2Deployer} from "../src/utils/Create2Deployer.sol";
import {MockMarketplace} from "../src/mocks/MockMarketplace.sol";
import {SeaportAdapter} from "../src/marketplace/SeaportAdapter.sol";

/// @title Deploy — Company.md on Robinhood Chain (mainnet 4663 / testnet 46630), Pons mode
/// @notice UNAUDITED — experimental.
/// @dev forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --broadcast --slow
///   Single stage, env-only (CI friendly): no prompts, no files required; the deployments JSON is printed to stdout
///   between the markers DEPLOYMENTS_JSON_BEGIN / DEPLOYMENTS_JSON_END and written to deployments/<chainId>.json.
///   $COMD is minted by Pons — this script never deploys a token on a real chain.
///   Env (all optional unless marked):
///   DEPLOYER_PRIVATE_KEY  (required) broadcaster; holds nothing and owns nothing after the run
///   STAGE                 "full" (default) or "mint": "mint" deploys only CounselNFT + the ERC-8004 registries so the
///                         free mint can open before the Pons launch; needs no COMD_TOKEN. The later "full" run reuses
///                         them when COUNSEL_NFT, IDENTITY_REGISTRY and REPUTATION_REGISTRY are set.
///   COMD_TOKEN            (required on mainnet 4663 and any non-test chain, STAGE=full) the Pons $COMD address.
///                         Test chains (46630, 31337): a MockComd (1B, 18 dec, to the deployer) is deployed if unset.
///   COUNSEL_NFT, IDENTITY_REGISTRY, REPUTATION_REGISTRY   reuse existing deployments (all three or none)
///   ADMIN                 owner/admin of everything (default: deployer). Use a multisig on mainnet. Flywheel is
///                         Ownable2Step: ADMIN must call acceptOwnership() on it after the run.
///   TREASURY              firm treasury: 20% of COMD job revenue, Counsel royalties (default: ADMIN)
///   SETTLER, KEEPER, REGISTRAR   (default: ADMIN)
///   POOL_MANAGER          mainnet default 0x8366…40951; testnet/local: deploys a v4 PoolManager if unset
///   SEAPORT               optional: deploys a SeaportAdapter for it and allowlists it in the Flywheel
///   MAX_SWEEP_PRICE       wei, default 0.5 ether
///   COUNSEL_BASE_URI      default "https://api.comd.fun/agents/by-token/"
///   WRITE_DEPLOYMENTS     default true: writes deployments/<chainId>.json
///   After the Pons graduation: ADMIN calls UniswapV4PoolSwapper.setPoolKey(fee, tickSpacing, ponsHook).
contract Deploy is Script {
    uint256 constant MAINNET = 4663;
    uint256 constant TESTNET = 46630;
    address constant MAINNET_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant MAINNET_WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant TESTNET_WETH = 0x7943e237c7F95DA44E0301572D358911207852Fa;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    uint160 constant GUARD_FLAGS = uint160(Hooks.BEFORE_INITIALIZE_FLAG);

    struct Config {
        address deployer;
        address admin;
        address treasury;
        address settler;
        address keeper;
        address registrar;
        address comd; // 0 = deploy MockComd (test chains only)
        address counsel; // 0 = deploy CounselNFT, else reuse
        address identityRegistry; // 0 = deploy the ERC-8004 registries, else reuse (with reputationRegistry)
        address reputationRegistry;
        bool mintOnly; // STAGE=mint: CounselNFT + registries only
        address poolManager; // 0 = deploy PoolManager (test chains only)
        address seaport; // 0 = no SeaportAdapter
        uint256 maxSweepPrice;
        string counselBaseURI;
    }

    struct Deployment {
        address poolManager;
        address create2Deployer;
        address comd;
        address counsel;
        address identityRegistry;
        address reputationRegistry;
        address identityImpl;
        address reputationImpl;
        address rewardDistributor;
        address revenueRouter;
        address flywheel;
        address swapper;
        address projectFactory;
        address contributorDistributor;
        address launchGuardHook;
        address incorporations;
        address mockMarketplace;
        address seaportAdapter;
        bool deployedPoolManager;
        bool deployedMockComd;
    }

    function run() external returns (Deployment memory d) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        Config memory c = configFromEnv(vm.addr(pk));
        vm.startBroadcast(pk);
        d = deploy(c);
        vm.stopBroadcast();
        _log(d);
        string memory json = toJson(c, d);
        console2.log("DEPLOYMENTS_JSON_BEGIN");
        console2.log(json);
        console2.log("DEPLOYMENTS_JSON_END");
        if (vm.envOr("WRITE_DEPLOYMENTS", true)) {
            _write(json);
        }
    }

    function configFromEnv(address me) public view returns (Config memory c) {
        c.deployer = me;
        c.admin = vm.envOr("ADMIN", me);
        c.treasury = vm.envOr("TREASURY", c.admin);
        c.settler = vm.envOr("SETTLER", c.admin);
        c.keeper = vm.envOr("KEEPER", c.admin);
        c.registrar = vm.envOr("REGISTRAR", c.admin);
        c.comd = vm.envOr("COMD_TOKEN", address(0));
        c.counsel = vm.envOr("COUNSEL_NFT", address(0));
        c.identityRegistry = vm.envOr("IDENTITY_REGISTRY", address(0));
        c.reputationRegistry = vm.envOr("REPUTATION_REGISTRY", address(0));
        c.mintOnly = keccak256(bytes(vm.envOr("STAGE", string("full")))) == keccak256("mint");
        c.poolManager = vm.envOr("POOL_MANAGER", block.chainid == MAINNET ? MAINNET_POOL_MANAGER : address(0));
        c.seaport = vm.envOr("SEAPORT", address(0));
        c.maxSweepPrice = vm.envOr("MAX_SWEEP_PRICE", uint256(0.5 ether));
        c.counselBaseURI = vm.envOr("COUNSEL_BASE_URI", string("https://api.comd.fun/agents/by-token/"));
    }

    function _isTestChain() internal view returns (bool) {
        return block.chainid == TESTNET || block.chainid == 31337;
    }

    /// @notice Deploys everything. All calls are made by `c.deployer` (broadcaster, or this script in tests).
    function deploy(Config memory c) public returns (Deployment memory d) {
        // ---- seats + identity (deployed here, or reused from the "mint" stage)
        if (c.counsel != address(0)) {
            require(c.counsel.code.length > 0, "COUNSEL_NFT has no code");
            d.counsel = c.counsel;
        } else {
            d.counsel = address(new CounselNFT(c.admin, c.treasury, c.counselBaseURI));
        }
        if (c.identityRegistry != address(0) || c.reputationRegistry != address(0)) {
            require(c.identityRegistry.code.length > 0 && c.reputationRegistry.code.length > 0, "registries: set both");
            d.identityRegistry = c.identityRegistry;
            d.reputationRegistry = c.reputationRegistry;
        } else {
            _deployErc8004(c, d);
        }
        if (c.mintOnly) return d; // STAGE=mint: the free mint can open before the Pons launch

        // ---- externals: the Pons $COMD token and the v4 PoolManager
        if (c.comd == address(0)) {
            require(_isTestChain(), "COMD_TOKEN required on this chain: set it to the Pons $COMD token address");
            c.comd = address(new MockComd());
            d.deployedMockComd = true;
        } else {
            require(c.comd.code.length > 0, "COMD_TOKEN has no code");
            IERC20Metadata(c.comd).decimals(); // must be an ERC-20 (decimals are read on-chain, not assumed)
        }
        d.comd = c.comd;
        if (c.poolManager == address(0)) {
            require(_isTestChain(), "POOL_MANAGER required on this chain");
            c.poolManager = address(new PoolManager(c.admin));
            d.deployedPoolManager = true;
        } else {
            require(c.poolManager.code.length > 0, "PoolManager has no code");
        }
        d.poolManager = c.poolManager;
        Create2Deployer c2 = new Create2Deployer();
        d.create2Deployer = address(c2);

        // ---- rewards + revenue
        RewardDistributor dist = new RewardDistributor(IERC20(d.comd), IERC721(d.counsel), c.deployer);
        d.rewardDistributor = address(dist);
        dist.grantRole(dist.SETTLER_ROLE(), c.settler);
        _handOver(address(dist), c.admin, c.deployer);
        d.revenueRouter = address(new RevenueRouter(IERC20(d.comd), d.rewardDistributor, c.treasury, c.admin));

        // ---- swapper (unconfigured until the Pons graduation: ADMIN calls setPoolKey) + flywheel
        d.swapper = address(new UniswapV4PoolSwapper(IPoolManager(c.poolManager), IERC20(d.comd), c.admin));
        Flywheel fw = new Flywheel(IERC20(d.comd), IERC721(d.counsel), c.deployer, c.keeper);
        d.flywheel = address(fw);
        fw.setSwapper(d.swapper);
        fw.setMaxSweepPrice(c.maxSweepPrice);
        if (_isTestChain()) {
            d.mockMarketplace = address(new MockMarketplace());
            fw.setAdapter(d.mockMarketplace, true);
        }
        if (c.seaport != address(0)) {
            d.seaportAdapter = address(new SeaportAdapter(c.seaport));
            fw.setAdapter(d.seaportAdapter, true);
        }
        if (c.admin != c.deployer) {
            fw.transferOwnership(c.admin); // Ownable2Step: ADMIN accepts
        }

        // ---- launches (pairing allowlist: ETH, COMD)
        ProjectFactory f = new ProjectFactory(IPoolManager(c.poolManager), c.deployer, c.admin);
        d.projectFactory = address(f);
        d.contributorDistributor = address(f.contributorDistributor());
        {
            bytes memory init =
                abi.encodePacked(type(LaunchGuardHook).creationCode, abi.encode(c.poolManager, d.projectFactory));
            d.launchGuardHook = c2.deploy(mineSalt(address(c2), keccak256(init), GUARD_FLAGS), init);
        }
        f.setGuardHook(IHooks(d.launchGuardHook));
        f.setPairedConfig(address(0), true, 1 ether, 1_000 ether);
        f.setPairedConfig(d.comd, true, 100_000e18, 100_000_000e18);
        f.grantRole(f.REGISTRAR_ROLE(), c.registrar);
        _handOver(address(f), c.admin, c.deployer);

        // ---- incorporations (1% fee → Counsel rewards; ETH paths through the same swapper)
        d.incorporations = address(
            new Incorporations(IERC20(d.comd), d.rewardDistributor, IBuybackSwapper(d.swapper), c.admin)
        );
    }

    /// @dev ERC-8004 v2 registries are UUPS implementations whose initialize() is reinitializer(2) onlyOwner:
    ///      proxy → ERC8004Bootstrap.initialize(deployer) → upgradeToAndCall(impl, initialize) → transfer to admin.
    function _deployErc8004(Config memory c, Deployment memory d) internal {
        address boot = address(new ERC8004Bootstrap());
        // deployed from the compiled artifacts (via-IR, see foundry.toml) so this script stays non-via-IR
        d.identityImpl = _create(vm.getCode("IdentityRegistryUpgradeable.sol:IdentityRegistryUpgradeable"));
        d.reputationImpl = _create(vm.getCode("ReputationRegistryUpgradeable.sol:ReputationRegistryUpgradeable"));
        bytes memory bootInit = abi.encodeCall(ERC8004Bootstrap.initialize, (c.deployer));
        d.identityRegistry = address(new ERC1967Proxy(boot, bootInit));
        d.reputationRegistry = address(new ERC1967Proxy(boot, bootInit));
        IERC8004Identity(d.identityRegistry).upgradeToAndCall(
            d.identityImpl, abi.encodeCall(IERC8004Identity.initialize, ())
        );
        IERC8004Identity(d.reputationRegistry).upgradeToAndCall(
            d.reputationImpl, abi.encodeCall(IERC8004Reputation.initialize, (d.identityRegistry))
        );
        if (c.admin != c.deployer) {
            IERC8004Identity(d.identityRegistry).transferOwnership(c.admin);
            IERC8004Reputation(d.reputationRegistry).transferOwnership(c.admin);
        }
    }

    function _create(bytes memory code) internal returns (address a) {
        assembly {
            a := create(0, add(code, 0x20), mload(code))
        }
        require(a != address(0), "create failed");
    }

    function _handOver(address target, address admin, address self) internal {
        if (admin == self) return;
        (bool ok,) = target.call(abi.encodeWithSignature("grantRole(bytes32,address)", bytes32(0), admin));
        require(ok, "grant");
        (ok,) = target.call(abi.encodeWithSignature("renounceRole(bytes32,address)", bytes32(0), self));
        require(ok, "renounce");
    }

    /// @notice Find a CREATE2 salt so the deployed address has exactly `flags` in its low 14 bits.
    function mineSalt(address deployer, bytes32 initCodeHash, uint160 flags) public view returns (bytes32 salt) {
        for (uint256 i; i < 2_000_000; ++i) {
            salt = bytes32(i);
            address a = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
            if (uint160(a) & Hooks.ALL_HOOK_MASK == flags && a.code.length == 0) return salt;
        }
        revert("salt not found");
    }

    /// @notice Writes deployments/<chainId>.json (also returns the JSON).
    function writeJson(Config memory c, Deployment memory d) public returns (string memory json) {
        json = toJson(c, d);
        _write(json);
    }

    function _write(string memory json) internal {
        string memory dir = string.concat(vm.projectRoot(), "/deployments");
        vm.createDir(dir, true); // fresh CI checkouts may not have it
        vm.writeJson(json, string.concat(dir, "/", vm.toString(block.chainid), ".json"));
    }

    function toJson(Config memory c, Deployment memory d) public returns (string memory json) {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployedAtBlock", block.number);
        vm.serializeString(k, "stage", c.mintOnly ? "mint" : "full");
        vm.serializeAddress(k, "comdToken", d.comd); // external (Pons); MockComd on test chains
        vm.serializeAddress(k, "counselNFT", d.counsel);
        vm.serializeAddress(k, "identityRegistry", d.identityRegistry);
        vm.serializeAddress(k, "reputationRegistry", d.reputationRegistry);
        vm.serializeAddress(k, "rewardDistributor", d.rewardDistributor);
        vm.serializeAddress(k, "revenueRouter", d.revenueRouter);
        vm.serializeAddress(k, "flywheel", d.flywheel);
        vm.serializeAddress(k, "swapper", d.swapper);
        vm.serializeAddress(k, "incorporations", d.incorporations);
        vm.serializeAddress(k, "projectFactory", d.projectFactory);
        vm.serializeAddress(k, "contributorDistributor", d.contributorDistributor);
        vm.serializeAddress(k, "launchGuardHook", d.launchGuardHook);
        vm.serializeAddress(k, "create2Deployer", d.create2Deployer);
        vm.serializeAddress(k, "mockMarketplace", d.mockMarketplace);
        vm.serializeAddress(k, "seaportAdapter", d.seaportAdapter);
        vm.serializeAddress(k, "admin", c.admin);
        vm.serializeAddress(k, "treasury", c.treasury);
        vm.serializeAddress(k, "keeper", c.keeper);
        vm.serializeAddress(k, "settler", c.settler);
        vm.serializeAddress(k, "registrar", c.registrar);
        vm.serializeAddress(k, "poolManager", d.poolManager);
        vm.serializeAddress(k, "weth", block.chainid == MAINNET ? MAINNET_WETH : TESTNET_WETH);
        json = vm.serializeAddress(k, "permit2", PERMIT2);
    }

    function _log(Deployment memory d) internal pure {
        console2.log("COMD (external)       ", d.comd);
        console2.log("PoolManager           ", d.poolManager);
        console2.log("CounselNFT            ", d.counsel);
        console2.log("IdentityRegistry      ", d.identityRegistry);
        console2.log("ReputationRegistry    ", d.reputationRegistry);
        console2.log("RewardDistributor     ", d.rewardDistributor);
        console2.log("RevenueRouter         ", d.revenueRouter);
        console2.log("Flywheel              ", d.flywheel);
        console2.log("UniswapV4PoolSwapper  ", d.swapper);
        console2.log("Incorporations        ", d.incorporations);
        console2.log("ProjectFactory        ", d.projectFactory);
        console2.log("ContributorDistributor", d.contributorDistributor);
        console2.log("LaunchGuardHook       ", d.launchGuardHook);
    }
}
