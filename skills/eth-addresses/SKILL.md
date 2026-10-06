---
id: eth-addresses
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
topics: [addresses, tokens, uniswap, infrastructure]
description: A table of widely used protocol addresses on Ethereum and major L2s, each to be verified on chain before use.
---

# Protocol addresses

## Purpose

Matters often need a well-known address: WETH on Base, USDC on Arbitrum, the Uniswap v4 PoolManager on
mainnet, Multicall3 anywhere. Guessing or copying from the wrong chain is one of the most common deployment
errors. This table lists addresses the firm has reason to trust, with the rule that none of them is used
without an on-chain check.

## How to apply

1. Find the address here (or in the protocol's official documentation).
2. Check it on the target chain: `cast code <addr> --rpc-url <rpc>` must return non-empty code; for tokens
   also `cast call <addr> "symbol()(string)"` and `"decimals()(uint8)"`.
3. Put it in configuration (env or a JSON config per chain), never as a literal in contract code.
4. If the check fails, stop: do not substitute an address from a search result.

For Robinhood Chain, use `eth-robinhood-chain`; it is maintained separately.

## Same address on many chains

| Contract | Address | Note |
|---|---|---|
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | deployed on most EVM chains |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Uniswap; deterministic deployment |
| CREATE2 deployer (Arachnid) | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | used by `forge script` for `new X{salt: s}()` |
| ERC-4337 EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | verify per chain |
| ERC-4337 EntryPoint v0.8 | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` | verify per chain |
| Safe singleton factory | `0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7` | deterministic deployments of Safe contracts |
| OP Stack WETH predeploy | `0x4200000000000000000000000000000000000006` | on OP Mainnet, Base, and other OP Stack chains |

## Ethereum mainnet (chain id 1)

| Contract | Address |
|---|---|
| WETH9 | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` |
| USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (6 decimals) |
| USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` (6 decimals; non-standard `approve`/`transfer` returns) |
| DAI | `0x6B175474E89094C44Da98b954EedeAC495271d0F` (non-standard permit) |
| Uniswap v4 PoolManager | `0x000000000004444c5dc75cB358380D2e3dE08A90` |
| Uniswap v3 Factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` |
| Uniswap SwapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` |
| Chainlink ETH/USD feed | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` |

## Base (chain id 8453)

| Contract | Address |
|---|---|
| WETH | `0x4200000000000000000000000000000000000006` |
| USDC (native) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Uniswap v4 PoolManager | `0x498581fF718922c3f8e6A244956aF099B2652b2b` |

## Arbitrum One (chain id 42161)

| Contract | Address |
|---|---|
| WETH | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` |
| USDC (native) | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| Uniswap v4 PoolManager | `0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32` |
| ArbSys precompile | `0x0000000000000000000000000000000000000064` |

## OP Mainnet (chain id 10)

| Contract | Address |
|---|---|
| WETH | `0x4200000000000000000000000000000000000006` |
| USDC (native) | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` |

## Pitfalls

- Bridged and native versions of a token coexist on L2s (USDC vs USDC.e). The matter must say which; prefer
  native issuance.
- Testnet addresses differ from mainnet for almost everything except deterministic deployments.
- Checksums: EIP-55 mixed case is a checksum, not decoration. Compare addresses case-insensitively in code
  and reject inputs whose checksum is wrong in UIs.
- An address with code is not necessarily the right contract: compare `symbol()`, `decimals()` and, for
  protocol contracts, a distinctive view function or the verified source on the explorer.

## Sources and freshness

Compiled for Company.md in 2026 from issuer and protocol documentation (Circle, Tether, Uniswap deployment
pages, Chainlink data feeds, Safe, ERC-4337 releases, OP Stack predeploy specification, Arbitrum precompile
docs). Addresses rarely change but new chains and versions appear often. Every entry here must pass the
on-chain check above at the time of use; if one fails, report it so the table can be corrected.
