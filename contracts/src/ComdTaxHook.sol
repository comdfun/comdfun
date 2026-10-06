// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {Position} from "v4-core/src/libraries/Position.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {LiquidityAmountsLib} from "./libraries/LiquidityAmountsLib.sol";
import {TickAlign} from "./libraries/TickAlign.sol";
import {LaunchMath} from "./libraries/LaunchMath.sol";

interface IFlywheelTaxSink {
    function notifyTax() external payable;
}

/// @title ComdTaxHook — the official COMD/ETH v4 pool of Company.md: 5% ETH tax + capped inventory with burns
/// @notice UNAUDITED — experimental. Do not use with funds you cannot afford to lose.
/// @notice Mechanics inspired by IMD's POOL4 (imd.fun), combined with a swap tax.
///
/// Pool key: currency0 = native ETH, currency1 = COMD, LP fee 0, tick spacing 200, hooks = this.
///
/// 1. **Opening.** `initializeAndSeed` (POL only, once) initializes the pool at the opening price for an initial
///    market cap in ETH and, in the SAME transaction, deposits the POL's COMD single-sided in the MAIN position
///    [minUsableTick, openTick] held by this hook. External `initialize` with this hook always reverts, so nobody can
///    trade before the liquidity exists (security review C-01). The cap starts at the seeded inventory. No function
///    removes the main liquidity.
/// 2. **Tax (applied first).** Every swap pays `taxBps` (default/max 500 = 5%) in ETH: 5% of the ETH a buyer pays /
///    5% of the gross ETH a seller receives, for all four swap kinds (beforeSwap delta for buy exact-in and sell
///    exact-out, which must fill completely; afterSwap delta for the other two). Forwarded to the Flywheel, or held
///    as ERC-6909 claims (`pendingTax`) until `flush()` when the PoolManager does not hold the ETH yet. Only the
///    Flywheel's own buyback through the official ComdRouter (router-attested caller) is exempt.
/// 3. **Inventory cap + trims (after the tax).** Inventory = COMD held by the main position. After every swap, if
///    inventory > cap, the hook removes the excess fraction of the main position's liquidity. Removing liquidity
///    does not move the price and never touches the swapper's delta (only the tax does): the executed quote is the
///    taxed quote. Trimmed COMD is split 85% burned / 6% Bond / 4.5% RewardDripper (sCOMD stakers) / 4.5%
///    RewardDistributor (Counsel seats); burn absorbs rounding. Trimmed ETH goes to the BuyWall.
/// 4. **Cap ratchet.** The cap never rises by itself; it decays ≤ `capDecayPerDay` (100,000 COMD/day) toward
///    max(`capFloor` (100,000 COMD), inventory after the previous swap).
/// 5. **Reference tick** for the BuyWall: moves toward the closing tick of earlier blocks only, ≤ `refStepTicks`
///    per block.
/// 6. **Owner powers** (Ownable2Step, renounceable): `setTaxBps` (0–500), `setParams` within hard bounds,
///    `setDestinations` (bond / dripper / distributor), `setRouter` and `setBuyWall` (once each). The owner cannot
///    remove liquidity, change the Flywheel, or take tax or trims.
/// @dev Flags 0x18CC: afterInitialize, beforeAddLiquidity, beforeSwap, afterSwap, before/afterSwapReturnDelta.
contract ComdTaxHook is IUnlockCallback, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint24 public constant POOL_FEE = 0;
    int24 public constant TICK_SPACING = 200;
    uint256 public constant BPS = 10_000;
    uint16 public constant MAX_TAX_BPS = 500;
    bytes32 public constant SALT = bytes32(0);
    bytes32 private constant EXPECTED_SLOT = keccak256("comd.taxhook.expected");

    // hard bounds for owner-set params (scaled to the 1B supply)
    uint256 public constant MIN_CAP_FLOOR = 1_000e18;
    uint256 public constant MAX_CAP_FLOOR = 100_000_000e18;
    uint256 public constant MAX_CAP_DECAY_PER_DAY = 1_000_000e18;
    uint16 public constant MIN_BURN_BPS = 5_000;
    uint16 public constant MAX_SIDE_BPS = 2_500;
    int24 public constant MAX_REF_STEP_TICKS = 2_000;

    struct Params {
        uint256 capFloor;
        uint256 capDecayPerDay;
        uint16 burnBps;
        uint16 bondBps;
        uint16 stakersBps;
        uint16 seatsBps;
        int24 refStepTicks;
    }

    struct Stats {
        uint256 trimmedComd;
        uint256 trimmedEth;
        uint256 split;
        uint256 burned;
        uint256 toBond;
        uint256 toStakers;
        uint256 toSeats;
    }

    IPoolManager public immutable poolManager;
    ERC20Burnable public immutable comd;
    address public immutable pol;
    IFlywheelTaxSink public immutable flywheel;

    address public router;
    address public buyWall;
    address public bond;
    address public dripper;
    address public distributor;

    uint16 public taxBps = MAX_TAX_BPS;
    bool public seeded;
    int24 public tickLower;
    int24 public tickUpper;
    PoolId public poolId;

    uint256 public cap;
    uint256 public lastInventory;
    uint256 public lastCapUpdate;

    int24 public refTick;
    int24 public lastTick;
    uint256 public lastObsBlock;

    /// @notice All tax ever charged (ETH) = forwarded to the Flywheel + `pendingTax`.
    uint256 public totalTaxed;
    /// @notice Tax / trim ETH / trim COMD held as PoolManager ERC-6909 claims, waiting for `flush()`.
    uint256 public pendingTax;
    uint256 public claimEth;
    uint256 public claimComd;

    Params internal _p;
    Stats internal _stats;

    event Seeded(int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 comd, uint256 initialMarketCapWei);
    event Taxed(address indexed sender, bool isBuy, uint256 tax, bool forwarded);
    event Flushed(uint256 tax, uint256 trimEth, uint256 trimComd);
    event CapUpdated(uint256 cap, uint256 inventory);
    event Trimmed(uint256 excess, uint128 liquidityRemoved, uint256 ethOut, uint256 comdOut);
    event Split(uint256 amount, uint256 burned, uint256 toBond, uint256 toStakers, uint256 toSeats);
    event TaxBpsSet(uint16 bps);
    event RouterSet(address router);
    event BuyWallSet(address buyWall);
    event ParamsSet(Params params);
    event DestinationsSet(address bond, address dripper, address distributor);

    error NotPoolManager();
    error NotPol();
    error NotBuyWall();
    error AlreadySeeded();
    error NotSeeded();
    error ExternalInitialize();
    error OnlyProtocolLiquidity();
    error WrongPool();
    error BadTax();
    error BadParams();
    error AlreadySet();
    error ZeroAddress();
    error ZeroLiquidity();
    error BadOpeningTick();
    error TaxedPartialFill();
    error NothingToFlush();
    error UnexpectedEth();

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    constructor(
        IPoolManager poolManager_,
        ERC20Burnable comd_,
        address pol_,
        IFlywheelTaxSink flywheel_,
        address owner_,
        address bond_,
        address dripper_,
        address distributor_
    ) Ownable(owner_) {
        if (
            address(poolManager_) == address(0) || address(comd_) == address(0) || pol_ == address(0)
                || address(flywheel_) == address(0) || bond_ == address(0) || dripper_ == address(0)
                || distributor_ == address(0)
        ) revert ZeroAddress();
        poolManager = poolManager_;
        comd = comd_;
        pol = pol_;
        flywheel = flywheel_;
        bond = bond_;
        dripper = dripper_;
        distributor = distributor_;
        _p = Params({
            capFloor: 100_000e18,
            capDecayPerDay: 100_000e18,
            burnBps: 8_500,
            bondBps: 600,
            stakersBps: 450,
            seatsBps: 450,
            refStepTicks: 200
        });
        poolId = poolKey().toId();
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    /// @dev Only the PoolManager pays ETH to the hook (tax `take`); it is forwarded at once.
    receive() external payable {
        if (msg.sender != address(poolManager)) revert UnexpectedEth();
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory p) {
        p.afterInitialize = true;
        p.beforeAddLiquidity = true;
        p.beforeSwap = true;
        p.afterSwap = true;
        p.beforeSwapReturnDelta = true;
        p.afterSwapReturnDelta = true;
    }

    function poolKey() public view returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(address(comd)), POOL_FEE, TICK_SPACING, IHooks(address(this)));
    }

    // =====================================================================================
    //                                  initialize + seed
    // =====================================================================================

    /// @notice POL only, once: initialize the official pool at the opening price for `initialMarketCapWei` (ETH value
    ///         of the whole supply) and deposit `comdAmount` COMD (approved to this hook) in the same transaction.
    function initializeAndSeed(uint256 initialMarketCapWei, uint256 comdAmount)
        external
        nonReentrant
        returns (uint128 liquidity)
    {
        if (msg.sender != pol) revert NotPol();
        if (seeded) revert AlreadySeeded();
        int24 open =
            TickAlign.floor(LaunchMath.openingTick(false, initialMarketCapWei, comd.totalSupply()), TICK_SPACING);
        int24 lower = TickAlign.minUsable(TICK_SPACING);
        if (open <= lower || open > TickAlign.maxUsable(TICK_SPACING)) revert BadOpeningTick();
        // the hook initializes its own pool: v4 skips afterInitialize for self-calls (noSelfCall)
        poolManager.initialize(poolKey(), TickMath.getSqrtPriceAtTick(open));
        tickLower = lower;
        tickUpper = open;
        liquidity = LiquidityAmountsLib.forAmount1(
            TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(open), comdAmount
        );
        if (liquidity == 0) revert ZeroLiquidity();
        uint256 paid = abi.decode(poolManager.unlock(abi.encode(true, liquidity)), (uint256));
        seeded = true;
        uint256 inv = inventory();
        cap = inv > _p.capFloor ? inv : _p.capFloor;
        lastInventory = inv;
        lastCapUpdate = block.timestamp;
        refTick = open;
        lastTick = open;
        lastObsBlock = block.number;
        emit Seeded(lower, open, liquidity, paid, initialMarketCapWei);
        emit CapUpdated(cap, inv);
    }

    // =====================================================================================
    //                                        hooks
    // =====================================================================================

    /// @dev Reached only for initializations by someone else (self-calls are skipped): always refused.
    function afterInitialize(address, PoolKey calldata, uint160, int24) external view onlyPoolManager returns (bytes4) {
        revert ExternalInitialize();
    }

    /// @dev The hook's own add skips this callback (noSelfCall). The only other allowed LP is the BuyWall.
    function beforeAddLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4)
    {
        if (sender != buyWall || sender == address(0)) revert OnlyProtocolLiquidity();
        return IHooks.beforeAddLiquidity.selector;
    }

    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata sp, bytes calldata hookData)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (!seeded) revert NotSeeded();
        if (PoolId.unwrap(key.toId()) != PoolId.unwrap(poolId)) revert WrongPool();
        uint256 bps = taxBps;
        if (bps == 0 || _exempt(sender, hookData)) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        uint256 tax;
        uint256 expected;
        if (sp.zeroForOne && sp.amountSpecified < 0) {
            uint256 ethIn = uint256(-sp.amountSpecified);
            tax = (ethIn * bps) / BPS;
            expected = ethIn - tax;
        } else if (!sp.zeroForOne && sp.amountSpecified > 0) {
            uint256 net = uint256(sp.amountSpecified);
            tax = (net * bps) / (BPS - bps);
            expected = net + tax;
        } else {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }
        _setExpected(expected);
        if (tax > 0) _collectTax(sender, sp.zeroForOne, tax);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(int128(int256(tax)), 0), 0);
    }

    function afterSwap(
        address sender,
        PoolKey calldata,
        SwapParams calldata sp,
        BalanceDelta delta,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, int128) {
        // 1. tax
        int128 hookDelta = _afterSwapTax(sender, sp, delta, hookData);
        // 2. reference tick + inventory cap / trim (never changes the swapper's delta)
        (, int24 tick,,) = poolManager.getSlot0(poolId);
        _observe(tick);
        _ratchetAndTrim();
        return (IHooks.afterSwap.selector, hookDelta);
    }

    function _afterSwapTax(address sender, SwapParams calldata sp, BalanceDelta delta, bytes calldata hookData)
        internal
        returns (int128)
    {
        uint256 bps = taxBps;
        if (bps == 0 || _exempt(sender, hookData)) return 0;
        int128 eth = delta.amount0(); // pool-side ETH delta (before any hook adjustment)
        if (sp.zeroForOne) {
            if (sp.amountSpecified < 0) {
                if (uint256(uint128(-eth)) != _expected()) revert TaxedPartialFill();
                return 0;
            }
            uint256 tax = (uint256(uint128(-eth)) * bps) / (BPS - bps);
            if (tax > 0) _collectTax(sender, true, tax);
            return int128(int256(tax));
        }
        if (sp.amountSpecified > 0) {
            if (uint256(uint128(eth)) != _expected()) revert TaxedPartialFill();
            return 0;
        }
        uint256 t = (uint256(uint128(eth)) * bps) / BPS;
        if (t > 0) _collectTax(sender, false, t);
        return int128(int256(t));
    }

    // =====================================================================================
    //                                     tax plumbing
    // =====================================================================================

    function _exempt(address sender, bytes calldata hookData) internal view returns (bool) {
        return sender == router && sender != address(0) && hookData.length == 32
            && abi.decode(hookData, (address)) == address(flywheel);
    }

    function _collectTax(address sender, bool isBuy, uint256 tax) internal {
        totalTaxed += tax;
        if (address(poolManager).balance >= tax) {
            poolManager.take(Currency.wrap(address(0)), address(this), tax);
            flywheel.notifyTax{value: tax}();
            emit Taxed(sender, isBuy, tax, true);
        } else {
            poolManager.mint(address(this), 0, tax);
            pendingTax += tax;
            emit Taxed(sender, isBuy, tax, false);
        }
    }

    // =====================================================================================
    //                                   cap + trims
    // =====================================================================================

    function _ratchetAndTrim() internal {
        uint256 inv = inventory();
        uint256 c = currentCap();
        cap = c;
        lastCapUpdate = block.timestamp;
        if (inv > c) {
            _trim(inv - c, inv);
            inv = inventory();
        }
        lastInventory = inv;
        emit CapUpdated(c, inv);
    }

    function _trim(uint256 excess, uint256 inv) internal {
        uint128 liq = positionLiquidity();
        if (liq == 0) return;
        // liquidity rounded up so the inventory lands at (or just under) the cap
        uint256 toRemove = (uint256(liq) * excess + inv - 1) / inv;
        if (toRemove > liq) toRemove = liq;
        if (toRemove == 0) return;
        (BalanceDelta d,) = poolManager.modifyLiquidity(
            poolKey(), ModifyLiquidityParams(tickLower, tickUpper, -int256(toRemove), SALT), ""
        );
        uint256 ethOut = d.amount0() > 0 ? uint256(uint128(d.amount0())) : 0;
        uint256 comdOut = d.amount1() > 0 ? uint256(uint128(d.amount1())) : 0;
        _stats.trimmedComd += comdOut;
        _stats.trimmedEth += ethOut;
        emit Trimmed(excess, uint128(toRemove), ethOut, comdOut);
        // ETH → BuyWall, COMD → split; physically if the PoolManager holds it now (and a BuyWall is set), else
        // ERC-6909 claims redeemed by flush()
        if (ethOut > 0) {
            uint256 avail = buyWall == address(0) ? 0 : address(poolManager).balance;
            uint256 t = ethOut < avail ? ethOut : avail;
            if (t > 0) poolManager.take(Currency.wrap(address(0)), buyWall, t);
            if (ethOut > t) {
                poolManager.mint(address(this), 0, ethOut - t);
                claimEth += ethOut - t;
            }
        }
        if (comdOut > 0) {
            uint256 avail = IERC20(address(comd)).balanceOf(address(poolManager));
            uint256 now_ = comdOut < avail ? comdOut : avail;
            if (now_ > 0) poolManager.take(Currency.wrap(address(comd)), address(this), now_);
            if (comdOut > now_) {
                poolManager.mint(address(this), uint160(address(comd)), comdOut - now_);
                claimComd += comdOut - now_;
            }
            _split(now_);
        }
    }

    /// @dev 85 / 6 / 4.5 / 4.5 by default; burn takes the rounding remainder so parts always sum exactly.
    function _split(uint256 amount) internal {
        if (amount == 0) return;
        uint256 toBond = (amount * _p.bondBps) / BPS;
        uint256 toStakers = (amount * _p.stakersBps) / BPS;
        uint256 toSeats = (amount * _p.seatsBps) / BPS;
        uint256 burned = amount - toBond - toStakers - toSeats;
        if (burned > 0) comd.burn(burned);
        IERC20 c = IERC20(address(comd));
        if (toBond > 0) c.safeTransfer(bond, toBond);
        if (toStakers > 0) c.safeTransfer(dripper, toStakers);
        if (toSeats > 0) c.safeTransfer(distributor, toSeats);
        _stats.split += amount;
        _stats.burned += burned;
        _stats.toBond += toBond;
        _stats.toStakers += toStakers;
        _stats.toSeats += toSeats;
        emit Split(amount, burned, toBond, toStakers, toSeats);
    }

    /// @notice BuyWall only: route COMD the wall bought through the same split (pulled from the BuyWall).
    function split(uint256 amount) external nonReentrant {
        if (msg.sender != buyWall || msg.sender == address(0)) revert NotBuyWall();
        IERC20(address(comd)).safeTransferFrom(msg.sender, address(this), amount);
        _split(amount);
    }

    // =====================================================================================
    //                                  reference tick
    // =====================================================================================

    /// @dev Moves toward the CLOSING tick of earlier blocks only, at most refStepTicks per block.
    function _observe(int24 tickNow) internal {
        if (block.number > lastObsBlock) {
            uint256 blocks = block.number - lastObsBlock;
            int256 maxMove = int256(_p.refStepTicks) * int256(blocks > 1_000_000 ? 1_000_000 : blocks);
            int256 diff = int256(lastTick) - int256(refTick);
            if (diff > maxMove) diff = maxMove;
            if (diff < -maxMove) diff = -maxMove;
            refTick = int24(int256(refTick) + diff);
            lastObsBlock = block.number;
        }
        lastTick = tickNow;
    }

    /// @notice Anyone: advance the reference with the current tick (what any swap does). Used by the BuyWall.
    function observe() external {
        if (!seeded) revert NotSeeded();
        (, int24 tick,,) = poolManager.getSlot0(poolId);
        _observe(tick);
    }

    // =====================================================================================
    //                                   flush (claims)
    // =====================================================================================

    /// @notice Permissionless: redeem everything held as ERC-6909 claims — tax → Flywheel, trim ETH → BuyWall,
    ///         trim COMD → split.
    function flush() external nonReentrant {
        if (pendingTax == 0 && claimEth == 0 && claimComd == 0) revert NothingToFlush();
        poolManager.unlock(abi.encode(false, uint128(0)));
    }

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (bool seed, uint128 liq) = abi.decode(data, (bool, uint128));
        if (seed) {
            (BalanceDelta d,) = poolManager.modifyLiquidity(
                poolKey(), ModifyLiquidityParams(tickLower, tickUpper, int256(uint256(liq)), SALT), ""
            );
            uint256 owed = uint256(uint128(-d.amount1()));
            poolManager.sync(Currency.wrap(address(comd)));
            IERC20(address(comd)).safeTransferFrom(pol, address(poolManager), owed);
            poolManager.settle();
            return abi.encode(owed);
        }
        uint256 tax = pendingTax;
        uint256 e = buyWall != address(0) ? claimEth : 0;
        uint256 c = claimComd;
        pendingTax = 0;
        claimEth -= e;
        claimComd = 0;
        if (tax + e > 0) poolManager.burn(address(this), 0, tax + e);
        if (tax > 0) {
            poolManager.take(Currency.wrap(address(0)), address(this), tax);
            flywheel.notifyTax{value: tax}();
        }
        if (e > 0) poolManager.take(Currency.wrap(address(0)), buyWall, e);
        if (c > 0) {
            poolManager.burn(address(this), uint160(address(comd)), c);
            poolManager.take(Currency.wrap(address(comd)), address(this), c);
            _split(c);
        }
        emit Flushed(tax, e, c);
        return "";
    }

    function _setExpected(uint256 v) private {
        bytes32 slot = EXPECTED_SLOT;
        assembly {
            tstore(slot, v)
        }
    }

    function _expected() private view returns (uint256 v) {
        bytes32 slot = EXPECTED_SLOT;
        assembly {
            v := tload(slot)
        }
    }

    // =====================================================================================
    //                                        owner
    // =====================================================================================

    function setTaxBps(uint16 bps) external onlyOwner {
        if (bps > MAX_TAX_BPS) revert BadTax();
        taxBps = bps;
        emit TaxBpsSet(bps);
    }

    /// @notice Set the official ComdRouter once (the only sender whose hookData can claim the Flywheel exemption).
    function setRouter(address router_) external onlyOwner {
        if (router != address(0)) revert AlreadySet();
        if (router_ == address(0)) revert ZeroAddress();
        router = router_;
        emit RouterSet(router_);
    }

    /// @notice Set the BuyWall once (the only other LP of the pool; receives trimmed ETH; may call `split`).
    function setBuyWall(address wall) external onlyOwner {
        if (buyWall != address(0)) revert AlreadySet();
        if (wall == address(0)) revert ZeroAddress();
        buyWall = wall;
        emit BuyWallSet(wall);
    }

    function setParams(Params calldata p) external onlyOwner {
        if (p.capFloor < MIN_CAP_FLOOR || p.capFloor > MAX_CAP_FLOOR) revert BadParams();
        if (p.capDecayPerDay > MAX_CAP_DECAY_PER_DAY) revert BadParams();
        if (uint256(p.burnBps) + p.bondBps + p.stakersBps + p.seatsBps != BPS) revert BadParams();
        if (p.burnBps < MIN_BURN_BPS || p.bondBps > MAX_SIDE_BPS || p.stakersBps > MAX_SIDE_BPS || p.seatsBps > MAX_SIDE_BPS) {
            revert BadParams();
        }
        if (p.refStepTicks < 1 || p.refStepTicks > MAX_REF_STEP_TICKS) revert BadParams();
        if (seeded) {
            cap = currentCap();
            lastCapUpdate = block.timestamp;
        }
        _p = p;
        if (seeded && cap < p.capFloor) cap = p.capFloor;
        emit ParamsSet(p);
    }

    function setDestinations(address bond_, address dripper_, address distributor_) external onlyOwner {
        if (bond_ == address(0) || dripper_ == address(0) || distributor_ == address(0)) revert ZeroAddress();
        bond = bond_;
        dripper = dripper_;
        distributor = distributor_;
        emit DestinationsSet(bond_, dripper_, distributor_);
    }

    // =====================================================================================
    //                                        views
    // =====================================================================================

    function params() external view returns (Params memory) {
        return _p;
    }

    /// @notice Lifetime totals of trims and of the 85/6/4.5/4.5 split (`split` = Σ amounts split).
    function stats() external view returns (Stats memory) {
        return _stats;
    }

    function positionLiquidity() public view returns (uint128) {
        return poolManager.getPositionLiquidity(
            poolId, Position.calculatePositionKey(address(this), tickLower, tickUpper, SALT)
        );
    }

    /// @notice COMD held by the main position at the current price.
    function inventory() public view returns (uint256 amount1) {
        if (!seeded) return 0;
        (uint160 sqrtP,,,) = poolManager.getSlot0(poolId);
        (, amount1) = LiquidityAmountsLib.amountsFor(
            sqrtP, TickMath.getSqrtPriceAtTick(tickLower), TickMath.getSqrtPriceAtTick(tickUpper), positionLiquidity()
        );
    }

    /// @notice Cap after decay at the current timestamp.
    function currentCap() public view returns (uint256) {
        uint256 target = lastInventory > _p.capFloor ? lastInventory : _p.capFloor;
        uint256 c = cap;
        if (c <= target) return c < _p.capFloor ? _p.capFloor : c;
        uint256 decay = (_p.capDecayPerDay * (block.timestamp - lastCapUpdate)) / 1 days;
        c = c > decay ? c - decay : 0;
        return c > target ? c : target;
    }

    /// @notice (sqrtPriceX96, tick) of the official pool.
    function slot0() external view returns (uint160 sqrtPriceX96, int24 tick) {
        (sqrtPriceX96, tick,,) = poolManager.getSlot0(poolId);
    }
}
