// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "v4-core/src/libraries/FixedPoint96.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {LiquidityAmountsLib} from "./LiquidityAmountsLib.sol";
import {TickAlign} from "./TickAlign.sol";

/// @title GraduationLib — the Uniswap v4 side of Incorporations' graduation (deployed as a linked library)
/// @notice Reviewed before launch (contracts/AUDIT.md). External library: Incorporations delegatecalls into it, so
///         `address(this)` inside is Incorporations (it owns the pool position and pays the settlements) and the
///         contract itself stays under the EIP-170 size limit.
library GraduationLib {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @notice A coin's Uniswap v4 pool after graduation (zeroed while it is still on the curve).
    struct Graduation {
        bool done;
        uint64 at;
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 comdIn;
        uint256 coinIn;
        uint256 coinBurned;
        uint256 feesComd;
        uint256 feesCoin;
    }

    struct Plan {
        address coin;
        address comd;
        uint24 fee;
        int24 spacing;
        IHooks hook;
        uint256 x; // virtual + real COMD on the curve
        uint256 comdAmt; // real COMD backing
        uint256 coinAmt; // unsold coins
    }

    /// @dev Pool key, full-range ticks, the opening price (the curve's spot price, virtual COMD included) and the
    ///      liquidity the reserves can fund — written into `g`. Returns the sqrt price for `initialize`.
    function plan(Graduation storage g, Plan memory p) external returns (uint160 sqrtP) {
        bool coinIs0 = p.coin < p.comd;
        g.key = coinIs0
            ? PoolKey(Currency.wrap(p.coin), Currency.wrap(p.comd), p.fee, p.spacing, p.hook)
            : PoolKey(Currency.wrap(p.comd), Currency.wrap(p.coin), p.fee, p.spacing, p.hook);
        // pool price = currency1 per currency0: COMD per coin when the coin is currency0, coins per COMD otherwise
        sqrtP = sqrtPriceX96(coinIs0 ? p.coinAmt : p.x, coinIs0 ? p.x : p.coinAmt);
        g.tickLower = TickAlign.minUsable(p.spacing);
        g.tickUpper = TickAlign.maxUsable(p.spacing);
        g.liquidity = LiquidityAmountsLib.forAmounts(
            sqrtP,
            TickMath.getSqrtPriceAtTick(g.tickLower),
            TickMath.getSqrtPriceAtTick(g.tickUpper),
            coinIs0 ? p.coinAmt : p.comdAmt,
            coinIs0 ? p.comdAmt : p.coinAmt
        );
    }

    /// @dev Inside the PoolManager unlock: add the planned liquidity and settle both currencies from this contract.
    function seed(Graduation storage g, IPoolManager pm) external returns (uint256 owe0, uint256 owe1) {
        PoolKey memory key = g.key;
        (BalanceDelta d,) = pm.modifyLiquidity(
            key, ModifyLiquidityParams(g.tickLower, g.tickUpper, int256(uint256(g.liquidity)), bytes32(0)), ""
        );
        owe0 = d.amount0() < 0 ? uint256(uint128(-d.amount0())) : 0;
        owe1 = d.amount1() < 0 ? uint256(uint128(-d.amount1())) : 0;
        _settle(pm, key.currency0, owe0);
        _settle(pm, key.currency1, owe1);
    }

    /// @dev Inside the PoolManager unlock: take the position's accrued fees into this contract.
    function collect(Graduation storage g, IPoolManager pm) external returns (uint256 f0, uint256 f1) {
        PoolKey memory key = g.key;
        (BalanceDelta f,) = pm.modifyLiquidity(key, ModifyLiquidityParams(g.tickLower, g.tickUpper, 0, bytes32(0)), "");
        f0 = f.amount0() > 0 ? uint256(uint128(f.amount0())) : 0;
        f1 = f.amount1() > 0 ? uint256(uint128(f.amount1())) : 0;
        if (f0 > 0) pm.take(key.currency0, address(this), f0);
        if (f1 > 0) pm.take(key.currency1, address(this), f1);
    }

    /// @notice Pool spot price as COMD wei per 1e18 coin wei.
    function spot(Graduation storage g, IPoolManager pm, address coin) external view returns (uint256) {
        (uint160 sqrtP,,,) = pm.getSlot0(g.key.toId());
        uint256 priceX96 = FullMath.mulDiv(sqrtP, sqrtP, FixedPoint96.Q96); // currency1 per currency0, Q96
        return Currency.unwrap(g.key.currency0) == coin
            ? FullMath.mulDiv(priceX96, 1e18, FixedPoint96.Q96)
            : FullMath.mulDiv(FixedPoint96.Q96, 1e18, priceX96);
    }

    function poolId(Graduation storage g) external view returns (bytes32) {
        return PoolId.unwrap(g.key.toId());
    }

    /// @dev sqrt(amount1 / amount0) in Q64.96, clamped to the pool manager's bounds.
    function sqrtPriceX96(uint256 amount0, uint256 amount1) public pure returns (uint160) {
        uint256 ratioX192 = FullMath.mulDiv(amount1, uint256(1) << 192, amount0);
        uint256 s = Math.sqrt(ratioX192);
        if (s < TickMath.MIN_SQRT_PRICE + 1) s = TickMath.MIN_SQRT_PRICE + 1;
        if (s > TickMath.MAX_SQRT_PRICE - 1) s = TickMath.MAX_SQRT_PRICE - 1;
        return uint160(s);
    }

    function _settle(IPoolManager pm, Currency cur, uint256 amount) private {
        if (amount == 0) return;
        pm.sync(cur);
        IERC20(Currency.unwrap(cur)).safeTransfer(address(pm), amount);
        pm.settle();
    }
}
