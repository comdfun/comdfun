// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IERC8004Identity, IERC8004Reputation} from "../src/interfaces/IERC8004.sol";

import {ComdToken} from "../src/ComdToken.sol";
import {CounselNFT} from "../src/CounselNFT.sol";
import {RewardDistributor} from "../src/RewardDistributor.sol";
import {RevenueRouter} from "../src/RevenueRouter.sol";
import {Flywheel} from "../src/Flywheel.sol";
import {ComdTaxHook, IFlywheelTaxSink} from "../src/ComdTaxHook.sol";
import {BuyWall, IComdTaxHookForWall} from "../src/BuyWall.sol";
import {StakedComd} from "../src/StakedComd.sol";
import {RewardDripper} from "../src/RewardDripper.sol";
import {Bond} from "../src/Bond.sol";
import {ComdRouter} from "../src/ComdRouter.sol";
import {Incorporations, IComdRouterSwaps, IRewardDripperLike} from "../src/Incorporations.sol";
import {ProjectFactory} from "../src/launch/ProjectFactory.sol";
import {LaunchGuardHook} from "../src/launch/LaunchGuardHook.sol";
import {ERC8004Bootstrap} from "../src/ERC8004Bootstrap.sol";
import {Create2Deployer} from "../src/utils/Create2Deployer.sol";
import {MockMarketplace} from "../src/mocks/MockMarketplace.sol";
import {SeaportAdapter} from "../src/marketplace/SeaportAdapter.sol";

/// @title Deploy — Company.md on Robinhood Chain (mainnet 4663 / testnet 46630)
/// @notice UNAUDITED — experimental.
/// @dev forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --broadcast --slow
///   Env-only (CI friendly): no prompts, no files required; the deployments JSON is printed to stdout
///   between the markers DEPLOYMENTS_JSON_BEGIN / DEPLOYMENTS_JSON_END.
///   Env (all optional unless marked). ADMIN must call acceptOwnership() on ComdTaxHook and Flywheel.
///   DEPLOYER_PRIVATE_KEY  (required) broadcaster; holds nothing and owns nothing after the run
///   ADMIN                 owner/admin of everything (default: deployer). Use a multisig on mainnet. Flywheel and
///                         ComdTaxHook are Ownable2Step: ADMIN must call acceptOwnership() on both.
///   POL (or POL_WALLET)   receives 100% of COMD and runs script/SeedPool.s.sol (default: ADMIN)
///   TREASURY              firm treasury: 20% of COMD job revenue, Bond ETH proceeds, Counsel royalties (default: ADMIN)
///   SETTLER, KEEPER, REGISTRAR   (default: ADMIN)
///   BOND_PRICE_WEI        wei per 1e18 COMD for the reserve Bond (default 1e10); Bond starts disabled
///   POOL_MANAGER          mainnet default 0x8366…40951; testnet/local: deploys a v4 PoolManager if unset
///   SEAPORT               optional: deploys a SeaportAdapter for it and allowlists it in the Flywheel
///   MAX_SWEEP_PRICE       wei, default 0.5 ether
///   COUNSEL_BASE_URI      default "https://api.comd.fun/agents/by-token/"
///   WRITE_DEPLOYMENTS     default true: writes deployments/<chainId>.json
contract Deploy is Script {
    uint256 constant MAINNET = 4663;
    uint256 constant TESTNET = 46630;
    address constant MAINNET_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant MAINNET_WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant TESTNET_WETH = 0x7943e237c7F95DA44E0301572D358911207852Fa;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    uint160 constant HOOK_FLAGS = uint160(
        Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );
    uint160 constant GUARD_FLAGS = uint160(Hooks.BEFORE_INITIALIZE_FLAG);

    struct Config {
        address deployer;
        address admin;
        address treasury;
        address pol;
        address settler;
        address keeper;
        address registrar;
        address poolManager; // 0 = deploy PoolManager (testnet/local only)
        uint256 bondPriceEth; // wei per 1e18 COMD
        address seaport; // 0 = no SeaportAdapter
        uint256 maxSweepPrice;
        string counselBaseURI;
    }

    struct Deployment {
        address poolManager;
        address stakedComd;
        address rewardDripper;
        address bond;
        address buyWall;
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
        address hook;
        address router;
        address projectFactory;
        address contributorDistributor;
        address launchGuardHook;
        address incorporations;
        address mockMarketplace;
        address seaportAdapter;
        bool deployedPoolManager;
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
        c.pol = vm.envOr("POL", vm.envOr("POL_WALLET", c.admin));
        c.settler = vm.envOr("SETTLER", c.admin);
        c.keeper = vm.envOr("KEEPER", c.admin);
        c.registrar = vm.envOr("REGISTRAR", c.admin);
        c.poolManager = vm.envOr("POOL_MANAGER", block.chainid == MAINNET ? MAINNET_POOL_MANAGER : address(0));
        c.bondPriceEth = vm.envOr("BOND_PRICE_WEI", uint256(1e10));
        c.seaport = vm.envOr("SEAPORT", address(0));
        c.maxSweepPrice = vm.envOr("MAX_SWEEP_PRICE", uint256(0.5 ether));
        c.counselBaseURI = vm.envOr("COUNSEL_BASE_URI", string("https://api.comd.fun/agents/by-token/"));
    }

    function _isTestChain() internal view returns (bool) {
        return block.chainid == TESTNET || block.chainid == 31337;
    }

    /// @notice Deploys everything. All calls are made by `c.deployer` (broadcaster, or this script in tests).
    function deploy(Config memory c) public returns (Deployment memory d) {
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

        // ---- token: 100% to the POL wallet, which seeds it into the official pool (SeedPool.s.sol)
        d.comd = address(new ComdToken(c.pol));

        // ---- seats + identity
        d.counsel = address(new CounselNFT(c.admin, c.treasury, c.counselBaseURI));
        _deployErc8004(c, d);

        // ---- rewards + revenue
        RewardDistributor dist = new RewardDistributor(IERC20(d.comd), IERC721(d.counsel), c.deployer);
        d.rewardDistributor = address(dist);
        dist.grantRole(dist.SETTLER_ROLE(), c.settler);
        _handOver(address(dist), c.admin, c.deployer);
        d.revenueRouter = address(new RevenueRouter(IERC20(d.comd), d.rewardDistributor, c.treasury, c.admin));

        // ---- staking + bond (destinations of the trim split)
        d.stakedComd = address(new StakedComd(IERC20(d.comd), c.admin));
        d.rewardDripper = address(new RewardDripper(IERC20(d.comd), d.stakedComd, c.admin));
        d.bond = address(new Bond(IERC20(d.comd), c.treasury, c.bondPriceEth, c.admin));

        // ---- flywheel, hook (mined address), buy wall, router
        Flywheel fw = new Flywheel(ERC20Burnable(d.comd), IERC721(d.counsel), c.deployer, c.keeper);
        d.flywheel = address(fw);
        d.hook = _deployHook(c, d, c2);
        d.buyWall = address(new BuyWall(IComdTaxHookForWall(d.hook), c.admin));
        d.router = address(new ComdRouter(IPoolManager(c.poolManager), IERC20(d.comd), IHooks(d.hook), 0, 200));
        ComdTaxHook(payable(d.hook)).setRouter(d.router);
        ComdTaxHook(payable(d.hook)).setBuyWall(d.buyWall);
        fw.setHook(d.hook);
        fw.setRouter(d.router);
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
            ComdTaxHook(payable(d.hook)).transferOwnership(c.admin);
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

        // ---- incorporations
        d.incorporations = address(
            new Incorporations(
                ERC20Burnable(d.comd), IComdRouterSwaps(d.router), IRewardDripperLike(d.rewardDripper), c.admin
            )
        );
    }

    function _deployHook(Config memory c, Deployment memory d, Create2Deployer c2) internal returns (address) {
        bytes memory init = abi.encodePacked(
            type(ComdTaxHook).creationCode,
            abi.encode(
                c.poolManager,
                d.comd,
                c.pol,
                IFlywheelTaxSink(d.flywheel),
                c.deployer,
                d.bond,
                d.rewardDripper,
                d.rewardDistributor
            )
        );
        return c2.deploy(mineSalt(address(c2), keccak256(init), HOOK_FLAGS), init);
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
        vm.serializeAddress(k, "admin", c.admin);
        vm.serializeAddress(k, "pol", c.pol);
        vm.serializeAddress(k, "treasury", c.treasury);
        vm.serializeAddress(k, "weth", block.chainid == MAINNET ? MAINNET_WETH : TESTNET_WETH);
        vm.serializeAddress(k, "permit2", PERMIT2);
        vm.serializeAddress(k, "poolManager", d.poolManager);
        vm.serializeAddress(k, "stakedComd", d.stakedComd);
        vm.serializeAddress(k, "rewardDripper", d.rewardDripper);
        vm.serializeAddress(k, "bond", d.bond);
        vm.serializeAddress(k, "buyWall", d.buyWall);
        vm.serializeBool(k, "deployedPoolManager", d.deployedPoolManager);
        vm.serializeAddress(k, "create2Deployer", d.create2Deployer);
        vm.serializeAddress(k, "comdToken", d.comd);
        vm.serializeAddress(k, "counselNFT", d.counsel);
        vm.serializeAddress(k, "identityRegistry", d.identityRegistry);
        vm.serializeAddress(k, "reputationRegistry", d.reputationRegistry);
        vm.serializeAddress(k, "rewardDistributor", d.rewardDistributor);
        vm.serializeAddress(k, "revenueRouter", d.revenueRouter);
        vm.serializeAddress(k, "flywheel", d.flywheel);
        vm.serializeAddress(k, "comdTaxHook", d.hook);
        vm.serializeAddress(k, "comdRouter", d.router);
        vm.serializeAddress(k, "projectFactory", d.projectFactory);
        vm.serializeAddress(k, "contributorDistributor", d.contributorDistributor);
        vm.serializeAddress(k, "launchGuardHook", d.launchGuardHook);
        vm.serializeAddress(k, "mockMarketplace", d.mockMarketplace);
        vm.serializeAddress(k, "seaportAdapter", d.seaportAdapter);
        json = vm.serializeAddress(k, "incorporations", d.incorporations);
    }

    function _log(Deployment memory d) internal pure {
        console2.log("PoolManager           ", d.poolManager);
        console2.log("ComdToken             ", d.comd);
        console2.log("CounselNFT            ", d.counsel);
        console2.log("IdentityRegistry      ", d.identityRegistry);
        console2.log("ReputationRegistry    ", d.reputationRegistry);
        console2.log("RewardDistributor     ", d.rewardDistributor);
        console2.log("RevenueRouter         ", d.revenueRouter);
        console2.log("Flywheel              ", d.flywheel);
        console2.log("ComdTaxHook           ", d.hook);
        console2.log("BuyWall               ", d.buyWall);
        console2.log("StakedComd            ", d.stakedComd);
        console2.log("RewardDripper         ", d.rewardDripper);
        console2.log("Bond                  ", d.bond);
        console2.log("ComdRouter            ", d.router);
        console2.log("ProjectFactory        ", d.projectFactory);
        console2.log("ContributorDistributor", d.contributorDistributor);
        console2.log("LaunchGuardHook       ", d.launchGuardHook);
        console2.log("Incorporations        ", d.incorporations);
    }
}
