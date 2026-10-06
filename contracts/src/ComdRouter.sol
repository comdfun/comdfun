// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ComdRouter — ETH <-> COMD swaps on the official Company.md pool (ComdTaxHook)
/// @notice UNAUDITED — experimental. Do not use with funds you cannot afford to lose.
/// @notice Exact-input swaps through PoolManager.unlock with a minimum output and a deadline. No owner, no fee of
///         its own; the pool's 5% ETH tax is applied by the hook, so every amount here is NET of the tax.
/// @notice The router passes its caller (`msg.sender`) to the hook as `hookData`. The hook trusts that value only
///         when the swap's sender is this router, and exempts exactly one caller from the tax: the Flywheel.
/// @notice Quotes (`quoteETHForComd`, `quoteComdForETH`) are NON-VIEW: they simulate the swap inside unlock and
///         revert with the result (V4Quoter style); call them with eth_call (viem `simulateContract`). They are
///         net of the tax for the calling address and equal the executed amount in the same state.
contract ComdRouter is IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;
    IERC20 public immutable comd;
    IHooks public immutable hook;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;

    error NotPoolManager();
    error Expired();
    error Slippage(uint256 out, uint256 minOut);
    error ZeroAmount();
    error QuoteResult(uint256 amountOut);
    error UnexpectedRevert(bytes data);
    error TransferFailed();

    event Swapped(address indexed sender, address indexed to, bool ethIn, uint256 amountIn, uint256 amountOut);

    struct CallbackData {
        bool quote;
        bool zeroForOne;
        uint256 amountIn;
        address payer;
        address to;
    }

    constructor(IPoolManager poolManager_, IERC20 comd_, IHooks hook_, uint24 fee_, int24 tickSpacing_) {
        poolManager = poolManager_;
        comd = comd_;
        hook = hook_;
        fee = fee_;
        tickSpacing = tickSpacing_;
    }

    receive() external payable {
        if (msg.sender != address(poolManager)) revert TransferFailed();
    }

    function poolKey() public view returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(address(comd)), fee, tickSpacing, hook);
    }

    // ------------------------------------------------------------------ swaps

    function swapExactETHForComd(uint256 minOut, address to, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 out)
    {
        if (block.timestamp > deadline) revert Expired();
        if (msg.value == 0) revert ZeroAmount();
        (uint256 used, uint256 got) = abi.decode(
            poolManager.unlock(abi.encode(CallbackData(false, true, msg.value, msg.sender, to))), (uint256, uint256)
        );
        out = got;
        if (out < minOut) revert Slippage(out, minOut);
        if (used < msg.value) _sendEth(msg.sender, msg.value - used);
        emit Swapped(msg.sender, to, true, used, out);
    }

    function swapExactComdForETH(uint256 amountIn, uint256 minOut, address to, uint256 deadline)
        external
        nonReentrant
        returns (uint256 out)
    {
        if (block.timestamp > deadline) revert Expired();
        if (amountIn == 0) revert ZeroAmount();
        (uint256 used, uint256 got) = abi.decode(
            poolManager.unlock(abi.encode(CallbackData(false, false, amountIn, msg.sender, to))), (uint256, uint256)
        );
        out = got;
        if (out < minOut) revert Slippage(out, minOut);
        emit Swapped(msg.sender, to, false, used, out);
    }

    // ------------------------------------------------------------------ quotes

    function quoteETHForComd(uint256 ethIn) external returns (uint256) {
        return _quote(true, ethIn);
    }

    function quoteComdForETH(uint256 amountIn) external returns (uint256) {
        return _quote(false, amountIn);
    }

    function _quote(bool zeroForOne, uint256 amountIn) internal returns (uint256) {
        if (amountIn == 0) return 0;
        try poolManager.unlock(abi.encode(CallbackData(true, zeroForOne, amountIn, msg.sender, address(0)))) {
            revert UnexpectedRevert("");
        } catch (bytes memory reason) {
            if (reason.length == 36 && bytes4(reason) == QuoteResult.selector) {
                uint256 out;
                assembly {
                    out := mload(add(reason, 36))
                }
                return out;
            }
            revert UnexpectedRevert(reason);
        }
    }

    // ---------------------------------------------------------------- callback

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        CallbackData memory d = abi.decode(raw, (CallbackData));
        PoolKey memory key = poolKey();
        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: d.zeroForOne,
                amountSpecified: -int256(d.amountIn),
                sqrtPriceLimitX96: d.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            abi.encode(d.payer)
        );
        int128 a0 = delta.amount0();
        int128 a1 = delta.amount1();
        uint256 paid;
        uint256 out;
        if (d.zeroForOne) {
            paid = uint256(uint128(-a0));
            out = uint256(uint128(a1));
        } else {
            paid = uint256(uint128(-a1));
            out = uint256(uint128(a0));
        }
        if (d.quote) revert QuoteResult(out);

        if (d.zeroForOne) {
            poolManager.settle{value: paid}();
            poolManager.take(key.currency1, d.to, out);
        } else {
            poolManager.sync(key.currency1);
            comd.safeTransferFrom(d.payer, address(poolManager), paid);
            poolManager.settle();
            poolManager.take(key.currency0, d.to, out);
        }
        return abi.encode(paid, out);
    }

    function _sendEth(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
