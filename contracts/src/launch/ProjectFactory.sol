// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

import {LaunchToken} from "./LaunchToken.sol";
import {ContributorDistributor} from "./ContributorDistributor.sol";
import {LiquidityAmountsLib} from "../libraries/LiquidityAmountsLib.sol";
import {TickAlign} from "../libraries/TickAlign.sol";
import {LaunchMath} from "../libraries/LaunchMath.sol";

/// @title ProjectFactory — deploys swarm launches (Registrar / deployer service only)
/// @notice UNAUDITED — experimental. Do not use with funds you cannot afford to lose.
///
/// Launch kinds (IMD parity): 0 custom_token, 1 evm_project, 2 univ4_hook, 3 evm_contracts.
/// - `deployContract(ref, salt, initCode)`: deterministic CREATE2 deployment of an attested build artifact
///   (project contracts, a launch's v4 hook mined for its flag bits, or contracts-only launches).
/// - `launch(params)`: deploys the launch token (LaunchToken template, CREATE2) and allocates its supply:
///     * 10% (contributorPoolBps) → ContributorDistributor under the deployer's Merkle root, claimable after
///       contributorLockSeconds (1 h). Root = 2% equal per working wallet + 8% equal per recently connected
///       seat, per-wallet cap 30% — all computed OFF-CHAIN by the deployer.
///     * poolBps (1,000–9,000 = 10–90% of supply) → single-sided liquidity in a v4 pool initialized BY THIS
///       FACTORY ONLY, paired with an allowlisted currency (ETH = address(0), COMD), opening market
///       cap within the per-currency bounds, fee tier 500 / 3000 / 10000.
///     * the rest → `remainderTo` (the paying wallet; required unless poolBps = 9,000).
///   Pools of kinds 0/1 use the LaunchGuardHook (beforeInitialize: factory only). Kind 2 uses the launch's
///   own hook; the factory still initializes the pool and reverts if it already exists.
/// - The LP position is held by this factory per launch (salt = launchId) on behalf of `lpOwner`
///   (the policy's lpPosition owner), who can collect fees, remove liquidity or hand the position over.
/// - Gas ceiling (gasCeilingWei) is enforced by the deployer service, not on-chain.
///
/// Admin powers (DEFAULT_ADMIN_ROLE, renounceable): grant/revoke REGISTRAR_ROLE (hot-key rotation), set the policy
/// (lock seconds ≤ 30 d, default lpOwner, paired currency allowlist + market cap bounds, guard hook once).
/// Safety nets (V7): admin `pause()` stops `launch` and `deployContract` (LP owners keep collecting/removing);
/// admin `rescueERC20`/`rescueETH` recover anything stranded in the factory (it holds nothing by design — every
/// launched token is in the pool, the distributor or `remainderTo` by the end of `launch`); admin
/// `rescueFromDistributor` recovers the ContributorDistributor's surplus above what claimants are owed.
contract ProjectFactory is AccessControl, Pausable, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    uint256 public constant BPS = 10_000;
    uint256 public constant STANDARD_SUPPLY = 1_000_000_000e18;
    uint256 public constant MIN_CUSTOM_SUPPLY = 1_000_000e18;
    uint256 public constant MAX_CUSTOM_SUPPLY = 1_000_000_000_000e18;
    uint16 public constant CONTRIBUTOR_POOL_BPS = 1_000;
    uint16 public constant RECENT_CONTRIBUTOR_BPS = 800; // informational: share of the 10% for recent seats
    uint16 public constant PER_WALLET_CAP_BPS = 3_000; // informational: enforced off-chain in roots
    uint16 public constant POOL_FLOOR_BPS = 1_000;
    uint16 public constant POOL_MAX_BPS = 9_000;
    uint64 public constant MAX_LOCK_SECONDS = 30 days;

    uint8 public constant KIND_CUSTOM_TOKEN = 0;
    uint8 public constant KIND_EVM_PROJECT = 1;
    uint8 public constant KIND_UNIV4_HOOK = 2;
    uint8 public constant KIND_EVM_CONTRACTS = 3;

    struct PairedConfig {
        bool allowed;
        uint256 minMarketCap;
        uint256 maxMarketCap;
    }

    struct LaunchParams {
        uint8 kind;
        string name;
        string symbol;
        uint256 totalSupply; // custom_token only; others must pass 0 or STANDARD_SUPPLY
        address paired; // address(0) = native ETH
        uint24 fee; // 500 | 3000 | 10000
        address hook; // univ4_hook only (the launch's own hook); else ignored
        uint256 initialMarketCap; // in paired atomic units for the whole supply
        uint16 poolBps; // 1,000–9,000 of supply
        address remainderTo;
        bytes32 contributorRoot;
        bytes32 salt;
        address lpOwner; // 0 = policy default
    }

    struct Launch {
        uint8 kind;
        address token;
        address paired;
        address lpOwner;
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 poolAmount;
        uint256 contributorAmount;
        uint256 remainderAmount;
        uint64 createdAt;
    }

    IPoolManager public immutable poolManager;
    ContributorDistributor public immutable contributorDistributor;
    IHooks public guardHook;
    address public defaultLpOwner;
    uint64 public contributorLockSeconds = 1 hours;
    uint256 public launchCount;

    mapping(uint24 => int24) public tickSpacingOf;
    mapping(address => PairedConfig) public pairedConfig;
    mapping(uint256 => Launch) internal _launches;

    event Launched(
        uint256 indexed launchId,
        uint8 kind,
        address indexed token,
        address indexed paired,
        bytes32 poolId,
        uint256 poolAmount,
        uint256 contributorAmount,
        uint256 remainderAmount,
        address remainderTo
    );
    event ContractDeployed(bytes32 indexed ref, address indexed deployed, bytes32 salt);
    event FeesCollected(uint256 indexed launchId, address to, uint256 amount0, uint256 amount1);
    event LiquidityRemoved(uint256 indexed launchId, address to, uint128 liquidity, uint256 amount0, uint256 amount1);
    event LpOwnerTransferred(uint256 indexed launchId, address from, address to);
    event PairedConfigSet(address indexed paired, bool allowed, uint256 minMarketCap, uint256 maxMarketCap);
    event PolicySet(uint64 contributorLockSeconds, address defaultLpOwner);
    event GuardHookSet(address hook);
    event Rescued(address indexed token, address indexed to, uint256 amount);

    error BadKind();
    error BadPoolBps();
    error BadSupply();
    error BadFee();
    error PairedNotAllowed();
    error MarketCapOutOfBounds();
    error RemainderRequired();
    error NoRoot();
    error NoGuardHook();
    error BadHook();
    error PoolExists();
    error BadPrice();
    error NotLpOwner();
    error NotPoolManager();
    error ZeroAddress();
    error AlreadySet();
    error BadLock();
    error TransferFailed();

    enum Op {
        Seed,
        Collect,
        Remove
    }

    constructor(IPoolManager poolManager_, address admin, address defaultLpOwner_) {
        if (address(poolManager_) == address(0) || admin == address(0) || defaultLpOwner_ == address(0)) {
            revert ZeroAddress();
        }
        poolManager = poolManager_;
        contributorDistributor = new ContributorDistributor(address(this));
        defaultLpOwner = defaultLpOwner_;
        tickSpacingOf[500] = 10;
        tickSpacingOf[3000] = 60;
        tickSpacingOf[10000] = 200;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // =====================================================================================
    //                                    registrar
    // =====================================================================================

    /// @notice CREATE2-deploy an attested build artifact. `ref` is the off-chain launch/job id (event only).
    function deployContract(bytes32 ref, bytes32 salt, bytes calldata initCode)
        external
        onlyRole(REGISTRAR_ROLE)
        whenNotPaused
        returns (address deployed)
    {
        deployed = Create2.deploy(0, salt, initCode);
        emit ContractDeployed(ref, deployed, salt);
    }

    function computeAddress(bytes32 salt, bytes32 initCodeHash) external view returns (address) {
        return Create2.computeAddress(salt, initCodeHash);
    }

    function launch(LaunchParams calldata p)
        external
        onlyRole(REGISTRAR_ROLE)
        nonReentrant
        whenNotPaused
        returns (uint256 launchId, address token)
    {
        uint256 supply = _validate(p);
        launchId = ++launchCount;

        token = address(
            new LaunchToken{salt: keccak256(abi.encode(launchId, p.salt))}(p.name, p.symbol, supply, address(this))
        );

        Launch storage l = _launches[launchId];
        l.kind = p.kind;
        l.token = token;
        l.paired = p.paired;
        l.lpOwner = p.lpOwner == address(0) ? defaultLpOwner : p.lpOwner;
        l.createdAt = uint64(block.timestamp);

        // 10% to the contributor distributor
        uint256 contributorAmount = (supply * CONTRIBUTOR_POOL_BPS) / BPS;
        IERC20(token).forceApprove(address(contributorDistributor), contributorAmount);
        contributorDistributor.register(
            launchId, token, p.contributorRoot, contributorAmount, uint64(block.timestamp) + contributorLockSeconds
        );
        l.contributorAmount = contributorAmount;

        // pool
        uint256 poolAmount = (supply * p.poolBps) / BPS;
        _initPoolAndSeed(l, launchId, p, supply, poolAmount);

        // remainder (incl. rounding dust of the seed) to the paying wallet
        uint256 rest = IERC20(token).balanceOf(address(this));
        address restTo = p.remainderTo != address(0) ? p.remainderTo : l.lpOwner;
        if (rest > 0) IERC20(token).safeTransfer(restTo, rest);
        l.remainderAmount = rest;

        emit Launched(
            launchId,
            p.kind,
            token,
            p.paired,
            PoolId.unwrap(l.key.toId()),
            l.poolAmount,
            contributorAmount,
            rest,
            restTo
        );
    }

    function _validate(LaunchParams calldata p) internal view returns (uint256 supply) {
        if (p.kind > KIND_UNIV4_HOOK) revert BadKind();
        if (p.poolBps < POOL_FLOOR_BPS || p.poolBps > POOL_MAX_BPS) revert BadPoolBps();
        if (p.poolBps < POOL_MAX_BPS && p.remainderTo == address(0)) revert RemainderRequired();
        if (tickSpacingOf[p.fee] == 0) revert BadFee();
        PairedConfig memory pc = pairedConfig[p.paired];
        if (!pc.allowed) revert PairedNotAllowed();
        if (p.initialMarketCap < pc.minMarketCap || p.initialMarketCap > pc.maxMarketCap) {
            revert MarketCapOutOfBounds();
        }
        if (p.contributorRoot == bytes32(0)) revert NoRoot();
        if (p.kind == KIND_CUSTOM_TOKEN) {
            supply = p.totalSupply == 0 ? STANDARD_SUPPLY : p.totalSupply;
            if (supply < MIN_CUSTOM_SUPPLY || supply > MAX_CUSTOM_SUPPLY) revert BadSupply();
        } else {
            if (p.totalSupply != 0 && p.totalSupply != STANDARD_SUPPLY) revert BadSupply();
            supply = STANDARD_SUPPLY;
        }
        if (p.kind == KIND_UNIV4_HOOK) {
            if (p.hook == address(0) || p.hook == address(guardHook)) revert BadHook();
        } else if (address(guardHook) == address(0)) {
            revert NoGuardHook();
        }
    }

    function _initPoolAndSeed(
        Launch storage l,
        uint256 launchId,
        LaunchParams calldata p,
        uint256 supply,
        uint256 poolAmount
    ) internal {
        bool tokenIs0 = l.token < p.paired; // ETH (0x0) is always currency0
        int24 spacing = tickSpacingOf[p.fee];
        PoolKey memory key = _buildKey(l.token, p, tokenIs0, spacing);
        (uint160 existing,,,) = poolManager.getSlot0(key.toId());
        if (existing != 0) revert PoolExists();

        int24 tick = TickAlign.floor(openingTick(tokenIs0, p.initialMarketCap, supply), spacing);
        poolManager.initialize(key, TickMath.getSqrtPriceAtTick(tick));
        l.key = key;
        if (tokenIs0) {
            l.tickLower = tick;
            l.tickUpper = TickAlign.maxUsable(spacing);
        } else {
            l.tickLower = TickAlign.minUsable(spacing);
            l.tickUpper = tick;
        }
        _seed(l, launchId, poolAmount, tokenIs0);
    }

    function _buildKey(address token, LaunchParams calldata p, bool tokenIs0, int24 spacing)
        internal
        view
        returns (PoolKey memory)
    {
        IHooks hooks = p.kind == KIND_UNIV4_HOOK ? IHooks(p.hook) : guardHook;
        return tokenIs0
            ? PoolKey(Currency.wrap(token), Currency.wrap(p.paired), p.fee, spacing, hooks)
            : PoolKey(Currency.wrap(p.paired), Currency.wrap(token), p.fee, spacing, hooks);
    }

    function _seed(Launch storage l, uint256 launchId, uint256 poolAmount, bool tokenIs0) internal {
        uint160 sa = TickMath.getSqrtPriceAtTick(l.tickLower);
        uint160 sb = TickMath.getSqrtPriceAtTick(l.tickUpper);
        uint128 liq = tokenIs0
            ? LiquidityAmountsLib.forAmount0(sa, sb, poolAmount)
            : LiquidityAmountsLib.forAmount1(sa, sb, poolAmount);
        bytes memory payload = abi.encode(launchId, liq, uint256(0), address(0));
        uint256 used = abi.decode(poolManager.unlock(abi.encode(Op.Seed, payload)), (uint256));
        l.liquidity = liq;
        l.poolAmount = used;
    }

    /// @notice Tick at which a token with `supply` opens at `marketCap` (paired atomic units) — unaligned.
    function openingTick(bool tokenIs0, uint256 marketCap, uint256 supply) public pure returns (int24) {
        return LaunchMath.openingTick(tokenIs0, marketCap, supply);
    }

    // =====================================================================================
    //                                  LP position owner
    // =====================================================================================

    function collectFees(uint256 launchId, address to) external nonReentrant returns (uint256 a0, uint256 a1) {
        Launch storage l = _launches[launchId];
        if (msg.sender != l.lpOwner) revert NotLpOwner();
        (a0, a1) = abi.decode(
            poolManager.unlock(abi.encode(Op.Collect, abi.encode(launchId, uint128(0), uint256(0), to))),
            (uint256, uint256)
        );
        emit FeesCollected(launchId, to, a0, a1);
    }

    function removeLiquidity(uint256 launchId, uint128 liquidity, address to)
        external
        nonReentrant
        returns (uint256 a0, uint256 a1)
    {
        Launch storage l = _launches[launchId];
        if (msg.sender != l.lpOwner) revert NotLpOwner();
        l.liquidity -= liquidity;
        (a0, a1) = abi.decode(
            poolManager.unlock(abi.encode(Op.Remove, abi.encode(launchId, liquidity, uint256(0), to))),
            (uint256, uint256)
        );
        emit LiquidityRemoved(launchId, to, liquidity, a0, a1);
    }

    function transferLpOwner(uint256 launchId, address newOwner) external {
        Launch storage l = _launches[launchId];
        if (msg.sender != l.lpOwner) revert NotLpOwner();
        if (newOwner == address(0)) revert ZeroAddress();
        l.lpOwner = newOwner;
        emit LpOwnerTransferred(launchId, msg.sender, newOwner);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (Op op, bytes memory payload) = abi.decode(data, (Op, bytes));
        (uint256 launchId, uint128 liq,, address to) = abi.decode(payload, (uint256, uint128, uint256, address));
        Launch storage l = _launches[launchId];
        PoolKey memory key = l.key;
        bytes32 salt = bytes32(launchId);
        if (op == Op.Seed) {
            (BalanceDelta d,) = poolManager.modifyLiquidity(
                key, ModifyLiquidityParams(l.tickLower, l.tickUpper, int256(uint256(liq)), salt), ""
            );
            bool tokenIs0 = Currency.unwrap(key.currency0) == l.token;
            int128 owedSigned = tokenIs0 ? d.amount0() : d.amount1();
            uint256 owed = uint256(uint128(-owedSigned));
            Currency c = tokenIs0 ? key.currency0 : key.currency1;
            poolManager.sync(c);
            IERC20(l.token).safeTransfer(address(poolManager), owed);
            poolManager.settle();
            return abi.encode(owed);
        }
        int256 delta = op == Op.Collect ? int256(0) : -int256(uint256(liq));
        (BalanceDelta d2,) =
            poolManager.modifyLiquidity(key, ModifyLiquidityParams(l.tickLower, l.tickUpper, delta, salt), "");
        uint256 a0 = d2.amount0() > 0 ? uint256(uint128(d2.amount0())) : 0;
        uint256 a1 = d2.amount1() > 0 ? uint256(uint128(d2.amount1())) : 0;
        if (a0 > 0) poolManager.take(key.currency0, to, a0);
        if (a1 > 0) poolManager.take(key.currency1, to, a1);
        return abi.encode(a0, a1);
    }

    // =====================================================================================
    //                                       admin
    // =====================================================================================

    /// @notice Set the LaunchGuardHook once (it is deployed after this factory, at a mined address).
    function setGuardHook(IHooks hook) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(guardHook) != address(0)) revert AlreadySet();
        if (address(hook) == address(0)) revert ZeroAddress();
        guardHook = hook;
        emit GuardHookSet(address(hook));
    }

    function setPairedConfig(address paired, bool allowed, uint256 minCap, uint256 maxCap)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (allowed && (minCap == 0 || minCap > maxCap)) revert MarketCapOutOfBounds();
        pairedConfig[paired] = PairedConfig(allowed, minCap, maxCap);
        emit PairedConfigSet(paired, allowed, minCap, maxCap);
    }

    function setPolicy(uint64 lockSeconds, address lpOwner_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (lockSeconds > MAX_LOCK_SECONDS) revert BadLock();
        if (lpOwner_ == address(0)) revert ZeroAddress();
        contributorLockSeconds = lockSeconds;
        defaultLpOwner = lpOwner_;
        emit PolicySet(lockSeconds, lpOwner_);
    }

    // ------------------------------------------------------------ safety nets

    /// @notice Stop new launches and registrar deployments. LP owners keep their position powers.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Recover tokens stranded in the factory (none are held by design).
    function rescueERC20(IERC20 token, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, amount);
        emit Rescued(address(token), to, amount);
    }

    /// @notice Recover ETH forced into the factory (it never holds ETH by design).
    function rescueETH(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Rescued(address(0), to, amount);
    }

    /// @notice Recover the ContributorDistributor's surplus (above what claimants are owed; see its `rescue`).
    function rescueFromDistributor(address token, address to, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        contributorDistributor.rescue(token, to, amount);
    }

    // =====================================================================================
    //                                       views
    // =====================================================================================

    function launches(uint256 launchId) external view returns (Launch memory) {
        return _launches[launchId];
    }
}
