// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {Position} from "v4-core/src/libraries/Position.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {LiquidityAmountsLib} from "./libraries/LiquidityAmountsLib.sol";
import {TickAlign} from "./libraries/TickAlign.sol";

interface IComdTaxHookForWall {
    function poolManager() external view returns (IPoolManager);
    function poolKey() external view returns (PoolKey memory);
    function poolId() external view returns (PoolId);
    function comd() external view returns (address);
    function seeded() external view returns (bool);
    function tickUpper() external view returns (int24);
    function refTick() external view returns (int24);
    function claimEth() external view returns (uint256);
    function slot0() external view returns (uint160, int24);
    function observe() external;
    function flush() external;
    function split(uint256 amount) external;
}

/// @title BuyWall — the protocol's standing ETH bid under the COMD price, on the official pool
/// @notice UNAUDITED — experimental. Do not use with funds you cannot afford to lose.
/// @notice Mechanics inspired by IMD's POOL4 buy wall (imd.fun). ETH freed by ComdTaxHook trims arrives here; a keeper's
///         `rebalance()` posts it as ONE wide ETH-only position ABOVE the current tick (= a bid for COMD below the
///         price). The wall's bid floor follows the hook's block-lagged reference tick + `wallGapTicks`, moving at
///         most `floorDecayTicksPerDay` per day in BOTH directions — toward the price at most one day's allowance per
///         update (security review H-01), so a reference pumped for a few blocks cannot drag the bid above the market.
///         `rebalance()` closes the old wall, routes the COMD it bought through the hook's 85/6/4.5/4.5 split
///         (`ComdTaxHook.split`), and re-posts all ETH (parks it while the price is below the floor). It runs when
///         new ETH ≥ `rebalanceThreshold` (0.1 ETH), the wall bought ≥ `minWallFill` COMD, or parked ETH can be
///         posted. Keeper tip: min(tipBps (≤ 1%) of the ETH handled, tipCap (≤ 0.002 ETH)).
/// @notice The hook accepts this contract as the pool's only other LP. Owner powers (Ownable2Step, renounceable):
///         `setParams` within hard bounds. The owner cannot withdraw the wall or its ETH.
contract BuyWall is IUnlockCallback, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;

    int24 public constant TICK_SPACING = 200;
    uint256 public constant BPS = 10_000;
    bytes32 public constant SALT = bytes32(0);

    int24 public constant MAX_FLOOR_DECAY_TICKS = 2_000;
    int24 public constant MAX_WALL_GAP_TICKS = 5_000;
    int24 public constant MAX_WALL_WIDTH_TICKS = 50_000;
    uint256 public constant MIN_REBALANCE_THRESHOLD = 0.001 ether;
    uint256 public constant MAX_REBALANCE_THRESHOLD = 10 ether;
    uint256 public constant MIN_WALL_FILL_FLOOR = 1e18;
    uint256 public constant MAX_WALL_FILL = 100_000_000e18;
    uint16 public constant MAX_TIP_BPS = 100;
    uint256 public constant MAX_TIP_CAP = 0.002 ether;

    struct Params {
        int24 floorDecayTicksPerDay;
        int24 wallGapTicks;
        int24 wallWidthTicks;
        uint256 rebalanceThreshold;
        uint256 minWallFill;
        uint16 tipBps;
        uint256 tipCap;
    }

    IComdTaxHookForWall public immutable hook;
    IPoolManager public immutable poolManager;
    IERC20 public immutable comd;

    int24 public wallLower;
    int24 public wallUpper;
    int24 internal _floorTick;
    bool internal _floorSet;
    uint256 public floorUpdatedAt;
    uint256 public wallEthPosted;
    uint256 public parkedEth;
    uint256 public totalWallBought;
    uint256 public totalTips;

    Params internal _p;

    event WallClosed(uint256 ethOut, uint256 comdBought);
    event WallPosted(int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 eth);
    event WallParked(uint256 eth, int24 floorTick, int24 currentTick);
    event Rebalanced(address indexed keeper, uint256 ethHandled, uint256 tip);
    event ParamsSet(Params params);

    error NotPoolManager();
    error NotSeeded();
    error NothingToRebalance();
    error BadParams();
    error UnexpectedEth();
    error TransferFailed();

    constructor(IComdTaxHookForWall hook_, address owner_) Ownable(owner_) {
        hook = hook_;
        poolManager = hook_.poolManager();
        comd = IERC20(hook_.comd());
        _p = Params({
            floorDecayTicksPerDay: 400,
            wallGapTicks: 200,
            wallWidthTicks: 4_000,
            rebalanceThreshold: 0.1 ether,
            minWallFill: 10_000e18,
            tipBps: 100,
            tipCap: 0.002 ether
        });
    }

    /// @dev ETH arrives only from the PoolManager (trim proceeds taken by the hook; our own wall removals).
    receive() external payable {
        if (msg.sender != address(poolManager)) revert UnexpectedEth();
    }

    // =====================================================================================
    //                                       rebalance
    // =====================================================================================

    function rebalance() external nonReentrant returns (uint256 tip) {
        if (!hook.seeded()) revert NotSeeded();
        hook.observe();
        if (hook.claimEth() > 0) hook.flush(); // trim ETH held as claims → here
        (uint160 sqrtP, int24 tick) = hook.slot0();
        (, uint256 wallComd) = wallAmounts(sqrtP);
        uint256 inflow = address(this).balance - parkedEth;
        bool canPost = parkedEth > 0 && TickAlign.ceil(previewFloorTick(), TICK_SPACING) > tick;
        if (wallComd < _p.minWallFill && inflow < _p.rebalanceThreshold && !canPost) revert NothingToRebalance();

        (uint256 handled, uint256 t, uint256 bought) =
            abi.decode(poolManager.unlock(""), (uint256, uint256, uint256));
        tip = t;
        if (bought > 0) {
            comd.forceApprove(address(hook), bought);
            hook.split(bought);
            totalWallBought += bought;
        }
        totalTips += tip;
        parkedEth = address(this).balance - tip;
        if (tip > 0) {
            (bool ok,) = msg.sender.call{value: tip}("");
            if (!ok) revert TransferFailed();
        }
        emit Rebalanced(msg.sender, handled, tip);
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        PoolKey memory key = hook.poolKey();
        uint256 bal0 = address(this).balance;
        uint256 spent;
        uint256 bought;
        uint128 wl = wallLiquidity();
        if (wl > 0) {
            (BalanceDelta d,) =
                poolManager.modifyLiquidity(key, ModifyLiquidityParams(wallLower, wallUpper, -int256(uint256(wl)), SALT), "");
            uint256 wEth = d.amount0() > 0 ? uint256(uint128(d.amount0())) : 0;
            bought = d.amount1() > 0 ? uint256(uint128(d.amount1())) : 0;
            if (wEth > 0) poolManager.take(key.currency0, address(this), wEth);
            if (bought > 0) poolManager.take(key.currency1, address(this), bought);
            spent = wallEthPosted > wEth ? wallEthPosted - wEth : 0;
            emit WallClosed(wEth, bought);
        }
        wallEthPosted = 0;
        // tip on ETH actually handled: new inflow + ETH the wall spent buying
        uint256 handled = (bal0 - parkedEth) + spent;
        uint256 tip = (handled * _p.tipBps) / BPS;
        if (tip > _p.tipCap) tip = _p.tipCap;
        uint256 avail = address(this).balance;
        if (tip > avail) tip = avail;
        _postWall(key, avail - tip);
        return abi.encode(handled, tip, bought);
    }

    function _postWall(PoolKey memory key, uint256 eth) internal {
        (, int24 tick) = hook.slot0();
        _updateFloor();
        int24 lower = TickAlign.ceil(_floorTick, TICK_SPACING);
        int24 maxT = TickAlign.maxUsable(TICK_SPACING);
        if (lower <= tick || lower >= maxT) {
            emit WallParked(eth, _floorTick, tick);
            return;
        }
        int24 upper = lower + TickAlign.ceil(_p.wallWidthTicks, TICK_SPACING);
        if (upper > maxT) upper = maxT;
        uint128 liq =
            LiquidityAmountsLib.forAmount0(TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), eth);
        if (liq == 0) {
            emit WallParked(eth, _floorTick, tick);
            return;
        }
        wallLower = lower;
        wallUpper = upper;
        (BalanceDelta d,) =
            poolManager.modifyLiquidity(key, ModifyLiquidityParams(lower, upper, int256(uint256(liq)), SALT), "");
        uint256 owed = uint256(uint128(-d.amount0()));
        poolManager.settle{value: owed}();
        wallEthPosted = owed;
        emit WallPosted(lower, upper, liq, owed);
    }

    // =====================================================================================
    //                                    floor (H-01 fix)
    // =====================================================================================

    function _updateFloor() internal {
        (int24 next, bool upd) = _floorNext();
        if (upd) {
            _floorTick = next;
            _floorSet = true;
            floorUpdatedAt = block.timestamp;
        } else if (!_floorSet) {
            // materialize the initial floor (opening tick + gap); floorUpdatedAt stays 0
            _floorTick = next;
            _floorSet = true;
        }
    }

    /// @dev Before the first rebalance the floor is the opening tick + gap with "updatedAt = 0": the first update may
    ///      move away from the price at once, toward it only one day's allowance.
    function _floorNext() internal view returns (int24, bool) {
        int24 target = _floorTarget(hook.refTick());
        int24 floor = floorTick();
        uint256 dt = block.timestamp - floorUpdatedAt;
        if (target < floor) {
            if (dt > 1 days) dt = 1 days;
        } else if (floorUpdatedAt == 0) {
            return (target, true);
        }
        int256 allowed = (int256(_p.floorDecayTicksPerDay) * int256(dt)) / 1 days;
        if (allowed == 0) return (floor, false);
        int256 d = int256(target) - int256(floor);
        if (d > allowed) d = allowed;
        if (d < -allowed) d = -allowed;
        return (int24(int256(floor) + d), true);
    }

    function _floorTarget(int24 ref) internal view returns (int24) {
        int256 t = int256(ref) + int256(_p.wallGapTicks);
        if (t > TickMath.MAX_TICK) t = TickMath.MAX_TICK;
        return int24(t);
    }

    /// @notice Current floor tick (the opening tick + gap until the first rebalance).
    function floorTick() public view returns (int24) {
        return _floorSet ? _floorTick : _floorTarget(hook.tickUpper());
    }

    /// @notice Floor tick a rebalance right now would use (before alignment), for keepers and UIs.
    function previewFloorTick() public view returns (int24 t) {
        (t,) = _floorNext();
    }

    // =====================================================================================
    //                                   owner + views
    // =====================================================================================

    function setParams(Params calldata p) external onlyOwner {
        if (p.floorDecayTicksPerDay < 1 || p.floorDecayTicksPerDay > MAX_FLOOR_DECAY_TICKS) revert BadParams();
        if (p.wallGapTicks < 0 || p.wallGapTicks > MAX_WALL_GAP_TICKS) revert BadParams();
        if (p.wallWidthTicks < TICK_SPACING || p.wallWidthTicks > MAX_WALL_WIDTH_TICKS) revert BadParams();
        if (p.rebalanceThreshold < MIN_REBALANCE_THRESHOLD || p.rebalanceThreshold > MAX_REBALANCE_THRESHOLD) {
            revert BadParams();
        }
        if (p.minWallFill < MIN_WALL_FILL_FLOOR || p.minWallFill > MAX_WALL_FILL) revert BadParams();
        if (p.tipBps > MAX_TIP_BPS || p.tipCap > MAX_TIP_CAP) revert BadParams();
        _p = p;
        emit ParamsSet(p);
    }

    function params() external view returns (Params memory) {
        return _p;
    }

    function wallLiquidity() public view returns (uint128) {
        if (wallLower == 0 && wallUpper == 0) return 0;
        return poolManager.getPositionLiquidity(
            hook.poolId(), Position.calculatePositionKey(address(this), wallLower, wallUpper, SALT)
        );
    }

    /// @notice (ETH, COMD) held by the wall at `sqrtP`.
    function wallAmounts(uint160 sqrtP) public view returns (uint256 eth, uint256 bought) {
        uint128 wl = wallLiquidity();
        if (wl == 0) return (0, 0);
        return LiquidityAmountsLib.amountsFor(
            sqrtP, TickMath.getSqrtPriceAtTick(wallLower), TickMath.getSqrtPriceAtTick(wallUpper), wl
        );
    }

    /// @notice Whether `rebalance()` would do work now (keepers / UI).
    function canRebalance() external view returns (bool) {
        if (!hook.seeded()) return false;
        (uint160 sqrtP, int24 tick) = hook.slot0();
        (, uint256 wallComd) = wallAmounts(sqrtP);
        uint256 inflow = address(this).balance + hook.claimEth() - parkedEth;
        bool canPost = parkedEth > 0 && TickAlign.ceil(previewFloorTick(), TICK_SPACING) > tick;
        return wallComd >= _p.minWallFill || inflow >= _p.rebalanceThreshold || canPost;
    }
}
