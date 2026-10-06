---
id: uniswap-v4-hooks
version: 1
kind: reference
origin: parity
role: reference
inference: none
tier: none
judge: none
requires: []
writes: none
checks: []
outputs: []
topics: [uniswap-v4, hooks, pool-manager, flash-accounting]
description: Uniswap v4 hook design: the singleton PoolManager, flash accounting, hook permissions, deltas, fees and periphery.
---

# Uniswap v4 hooks

## Purpose

Design knowledge for `univ4_hook` launches and any matter that builds on Uniswap v4, including Company.md's own
ComdTaxHook on the COMD/ETH pool: a 5% ETH tax on every buy and sell (forwarded to the Flywheel for
buyback-and-burn and Counsel floor sweeps) plus a capped inventory whose excess COMD is trimmed after swaps, with a
separate BuyWall contract holding the protocol's standing ETH bid in the same pool. Read `uniswap-v4-security` alongside it; this file explains how v4
works, that one explains how hooks fail.

## How to apply

Before writing a hook, decide which callbacks it needs (permissions are fixed by the deployed address), how it
accounts for any tokens it touches (deltas), and who may create pools with it. Use v4-periphery's `BaseHook`
and pin v4-core and v4-periphery to exact commits; v4-core's `PoolManager` declares `pragma solidity 0.8.26`
exactly, so tests that deploy it compile with 0.8.26.

## Architecture

- One `PoolManager` holds every pool's state and tokens. A pool is identified by
  `PoolKey { currency0, currency1, fee, tickSpacing, hooks }`; `PoolId = keccak256(abi.encode(key))`.
  `currency0 < currency1` by address; native ETH is `address(0)` and therefore always `currency0`.
- Flash accounting: callers `unlock(data)` the manager, which calls back `unlockCallback(data)`. Inside, swaps
  and liquidity changes create per-currency deltas (stored with transient storage, EIP-1153). Before the
  callback returns, every delta must be zero: the caller pays what it owes and takes what it is owed. Otherwise
  the manager reverts (`CurrencyNotSettled`).
- Settling: for ERC-20s call `sync(currency)`, transfer tokens to the manager, then `settle()`; for ETH call
  `settle{value: amount}()`. Receiving: `take(currency, to, amount)`. ERC-6909 claims (`mint`/`burn`) let
  users leave balances inside the manager instead of transferring.
- Sign conventions: in `swap`, a negative `amountSpecified` is exact input and a positive one exact output.
  `BalanceDelta` values are from the caller's perspective: negative means the caller owes the pool.
- Reads: `StateView` (periphery) exposes slot0, liquidity and positions without unlocking. Positions are
  managed through `PositionManager` (ERC-721 positions, batched `modifyLiquidities` actions). Swaps go
  through the `UniversalRouter` (`V4_SWAP` command with `V4Router` actions such as `SWAP_EXACT_IN_SINGLE`,
  `SETTLE_ALL`, `TAKE_ALL`).

## Hook permissions

A hook's address encodes which callbacks the manager will call, in its lowest 14 bits:
`beforeInitialize`, `afterInitialize`, `beforeAddLiquidity`, `afterAddLiquidity`, `beforeRemoveLiquidity`,
`afterRemoveLiquidity`, `beforeSwap`, `afterSwap`, `beforeDonate`, `afterDonate`, and the four delta-returning
flags `beforeSwapReturnDelta`, `afterSwapReturnDelta`, `afterAddLiquidityReturnDelta`,
`afterRemoveLiquidityReturnDelta`.

- Mine a CREATE2 salt so the deployed address has exactly the required bits (`HookMiner` in v4-periphery
  utilities). In `forge script`, deploy through the CREATE2 deployer with the mined salt.
- `BaseHook.getHookPermissions()` must return the same flags; `validateHookAddress` checks this at construction.
- Permissions cannot change after deployment. Logic behind them can only change if the hook is upgradeable,
  which users must be told about.

## Callbacks in practice

- Every callback receives `sender` (the contract that called the manager, usually a router, not the user),
  the `PoolKey`, the operation's parameters and `hookData` (arbitrary bytes from the caller).
- Return values: each callback returns its selector; `beforeSwap` also returns a `BeforeSwapDelta` and an
  optional LP fee override; `afterSwap` returns an `int128` delta on the unspecified currency when the
  return-delta permission is set.
- Return deltas let a hook take or give tokens as part of the swap (custom curves, fees in the hook, NoOp swaps
  that bypass the AMM). The hook must then settle those amounts with the manager in the same unlock.
- Hooks that act after a swap (like a trim or a burn) should never change the price the swapper was quoted; do
  their own accounting with separate deltas and keep it bounded in gas.

## Fees

- Static fee: `fee` in the key, in hundredths of a bip (3000 = 0.30%). `tickSpacing` is independent of fee in
  v4 and must be within 1..32767.
- Dynamic fee: set `fee = 0x800000` (`LPFeeLibrary.DYNAMIC_FEE_FLAG`); the hook calls
  `poolManager.updateDynamicLPFee(key, newFee)` or returns an override from `beforeSwap` with the override flag
  (`0x400000`) set.
- Protocol fees are separate and controlled by Uniswap governance's fee controller.

## Pool creation and liquidity

- Anyone can `initialize` a pool with any hook unless the hook's `beforeInitialize` restricts it. Hooks that
  hold per-pool state or assume a specific pair must check the key there.
- Company.md's ProjectFactory initialises launch pools itself (factory-only initialisation), so the hook should
  accept initialisation only from the factory or only for the expected key.
- Protocol-owned liquidity positions belong to the policy's `lpPosition` owner, never to an EOA that can pull them.
- A hook may own the position itself and change it inside its own callbacks (the PoolManager is already unlocked
  during `afterSwap`): ComdTaxHook seeds its single position atomically in `initializeAndSeed`, and after each swap
  removes liquidity holding COMD above its cap, settling the removed tokens to itself. Changes made in `afterSwap`
  do not affect the swap that triggered them.
- Hook-owned positions with no withdrawal function are locked forever; that is a promise to traders and a loss of
  every remedy for the operator.

## Testing hooks

- Use v4-core's `Deployers` test utilities to deploy a manager, routers and currencies, then
  `deployCodeTo` the hook at a mined address in tests.
- Test swaps in both directions, exact input and exact output, native ETH and ERC-20 pairs, zero-liquidity and
  price-limit edges, and multiple pools sharing one hook.

## Sources and freshness

Written for Company.md in 2026 from the Uniswap v4 documentation, v4-core and v4-periphery sources (Hooks,
PoolManager, LPFeeLibrary, BaseHook), and public hook examples. v4 periphery APIs (PositionManager actions,
router commands) evolve; pin commits and read the source at the pinned commit.
