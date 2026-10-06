// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IBuybackSwapper} from "../interfaces/IBuybackSwapper.sol";

/// @title UniswapV4PoolSwapper — IBuybackSwapper over one Uniswap v4 ETH/COMD pool
/// @notice Reviewed before launch: an internal security review plus an independent security review (contracts/AUDIT.md).
/// @notice Exact-input ETH <-> COMD swaps through `IPoolManager.unlock` on an owner-configured pool: after Pons
///         graduates $COMD into its v4 position, the owner calls `setPoolKey(fee, tickSpacing, hooks)` with
///         Pons's pool parameters (currency0 is always ETH, currency1 always COMD). Until then every swap reverts
///         `PoolNotSet()`. Holds nothing between calls; no fee of its own; empty hookData. Owner `sweep(token, to)`
///         recovers anything forced in (V7 safety net).
/// @notice Quotes (`quoteETHForComd`, `quoteComdForETH`) are NON-VIEW: they simulate the swap inside unlock and
///         revert with the result (V4Quoter style); call them with eth_call (viem `simulateContract`).
/// @dev Pons's hook may charge its tax inside the swap (amounts here are whatever the pool returns) or may reject
///      swaps from arbitrary unlock callers; if so, a different IBuybackSwapper (e.g. through Pons's or Uniswap's
///      router) is plugged into the Flywheel and Incorporations with `setSwapper`.
contract UniswapV4PoolSwapper is IBuybackSwapper, IUnlockCallback, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    IPoolManager public immutable poolManager;
    IERC20 public immutable comd;

    uint24 public fee;
    int24 public tickSpacing;
    IHooks public hooks;
    bool public configured;

    error NotPoolManager();
    error PoolNotSet();
    error Expired();
    error Slippage(uint256 out, uint256 minOut);
    error ZeroAmount();
    error ZeroAddress();
    error QuoteResult(uint256 amountOut);
    error UnexpectedRevert(bytes data);
    error TransferFailed();

    event PoolKeySet(uint24 fee, int24 tickSpacing, address hooks, PoolId poolId);
    event Swapped(address indexed sender, address indexed to, bool ethIn, uint256 amountIn, uint256 amountOut);
    event Swept(address indexed token, address indexed to, uint256 amount);

    struct CallbackData {
        bool quote;
        bool zeroForOne;
        uint256 amountIn;
        address payer;
        address to;
    }

    constructor(IPoolManager poolManager_, IERC20 comd_, address owner_) Ownable(owner_) {
        if (address(poolManager_) == address(0) || address(comd_) == address(0)) revert ZeroAddress();
        poolManager = poolManager_;
        comd = comd_;
    }

    receive() external payable {
        if (msg.sender != address(poolManager)) revert TransferFailed();
    }

    // ------------------------------------------------------------------ owner

    /// @notice Point at the (Pons) ETH/COMD pool. Can be changed later (e.g. a new pool or hook).
    function setPoolKey(uint24 fee_, int24 tickSpacing_, IHooks hooks_) external onlyOwner {
        if (tickSpacing_ <= 0) revert ZeroAmount();
        fee = fee_;
        tickSpacing = tickSpacing_;
        hooks = hooks_;
        configured = true;
        emit PoolKeySet(fee_, tickSpacing_, address(hooks_), poolKey().toId());
    }

    /// @notice Safety net (V7): move out anything left behind (the swapper holds nothing between calls; ETH can
    ///         only be forced in by selfdestruct, tokens by a plain transfer). `token` = 0 sweeps ETH.
    function sweep(address token, address to) external onlyOwner nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        if (token == address(0)) {
            amount = address(this).balance;
            if (amount > 0) _sendEth(to, amount);
        } else {
            amount = IERC20(token).balanceOf(address(this));
            if (amount > 0) IERC20(token).safeTransfer(to, amount);
        }
        emit Swept(token, to, amount);
    }

    function poolKey() public view returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(address(comd)), fee, tickSpacing, hooks);
    }

    function poolId() external view returns (PoolId) {
        return poolKey().toId();
    }

    // ------------------------------------------------------------------ swaps

    function swapExactETHForComd(uint256 minOut, address to, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 out)
    {
        if (!configured) revert PoolNotSet();
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
        if (!configured) revert PoolNotSet();
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
        if (!configured) revert PoolNotSet();
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
            ""
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
            if (out > 0) poolManager.take(key.currency1, d.to, out);
        } else {
            poolManager.sync(key.currency1);
            comd.safeTransferFrom(d.payer, address(poolManager), paid);
            poolManager.settle();
            if (out > 0) poolManager.take(key.currency0, d.to, out);
        }
        return abi.encode(paid, out);
    }

    function _sendEth(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
