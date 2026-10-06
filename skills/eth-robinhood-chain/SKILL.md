---
id: eth-robinhood-chain
version: 1
kind: reference
origin: comd
role: reference
inference: none
tier: none
judge: none
requires: []
writes: none
checks: []
outputs: []
topics: [robinhood-chain, arbitrum-orbit, comd, addresses, rpc]
description: Facts about Robinhood Chain, the network Company.md runs on: ids, RPCs, explorers, core addresses and Orbit behaviour.
---

# Robinhood Chain

## Purpose

Company.md's own reference for the chain everything settles on. It collects the identifiers and addresses the
firm uses (from the build spec), the behaviour Robinhood Chain inherits from the Arbitrum Nitro stack, and the
rules for using these facts safely. Company.md is not affiliated with Robinhood; any page or document that
names the chain says so.

## How to apply

Use the tables for configuration, never as unquestioned truth: every address must be checked with
`eth_getCode` (and, for tokens, `symbol()`/`decimals()`) on the target chain before a deployment script or
frontend relies on it. Prefer the environment variables listed below over literals in code. Start on testnet
(46630); mainnet (4663) only after audit.

## Network identifiers

| | Mainnet | Testnet |
|---|---|---|
| Chain id | 4663 | 46630 |
| CAIP-2 | `eip155:4663` | `eip155:46630` |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` (also robin.etherscan.io) | Blockscout testnet instance |
| Gas token | ETH (18 decimals) | ETH (testnet) |

viem definition sketch: `defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether",
symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } } })`.

## Core addresses used by the firm

| Contract | Mainnet 4663 | Testnet 46630 | Status |
|---|---|---|---|
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | `0x7943e237c7F95DA44E0301572D358911207852Fa` | from Robinhood's protocol-contracts docs |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | same if deployed, else the firm deploys it | canonical deterministic address; verify |
| COMD (Company.md) | per deployment: `comdToken` in `contracts/deployments/<chainId>.json` | deployed by the firm | 18 decimals; the payment asset |
| Uniswap v4 PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | deploy or env | unverified: confirm before use |
| UniversalRouter 2.1.2 | `0x204FAca1764B154221e35c0d20aBb3c525710498` | env | unverified: confirm before use |
| PositionManager, StateView, V4Quoter | env | env | not yet located |
| ERC-8004 Identity / Reputation | deployed by the firm (CC0 reference contracts) | deployed by the firm | addresses in `@company/abi` |

Environment names used across the repo: `CHAIN_ID`, `RPC_URL`, `PERMIT2_ADDRESS`, `COUNSEL_NFT`,
`COMD_TOKEN`, `COMD_ROUTER`, `COMD_TAX_HOOK`, `FLYWHEEL`,
`IDENTITY_REGISTRY`, `REPUTATION_REGISTRY`,
`PROJECT_FACTORY`, `REWARD_DISTRIBUTOR`, `CONTRIBUTOR_DISTRIBUTOR`, `REVENUE_ROUTER`. The per-chain address book is `packages/abi` (`addresses.ts`).

## Behaviour inherited from the Arbitrum Nitro stack

Robinhood Chain is built with Arbitrum technology (an Orbit chain). Consequences for code:

- `block.number` is the parent chain's block number estimate, not the L2 block. Use
  `ArbSys(address(0x64)).arbBlockNumber()` when you need the chain's own block height, and
  `block.timestamp` for time.
- Blocks are produced by a sequencer on demand and are far shorter than Ethereum's 12 s.
- `block.prevrandao` provides no randomness.
- Fees include a parent-chain data component; estimate with the chain's RPC (`eth_estimateGas`), not with
  Ethereum mainnet assumptions. Keep the Registrar's `gasCeilingWei` policy in mind.
- Messages from the parent chain arrive from aliased addresses (+`0x1111…1111`).
- Precompiles: `ArbSys` 0x64, `ArbGasInfo` 0x6c. Opcode availability follows the chain's ArbOS version:
  query `ArbSys.arbOSVersion()` and compile with a matching `evm_version` (the firm uses `cancun`).

## COMD and stablecoin specifics

- $COMD (`ComdToken`, "Company.md"/"COMD"): 18 decimals, fixed supply of 1,000,000,000, ERC-20 + permit + burn.
  Matters are paid in COMD; amounts in the API are atomic units (1 COMD = 10^18), default price 100 COMD.
- The token has no transfer tax: wallet transfers and Permit2 payments move the exact amount. The 5% tax is
  taken only by `ComdTaxHook` on buys and sells in the official COMD/ETH Uniswap v4 pool, in ETH.
- Payments use Permit2 (`permitWitnessTransferFrom`), so no token-specific permit flow is required.
- Issuer stablecoins on the chain (6 decimals is typical: read `decimals()`) can freeze addresses and pause transfers.
  Contracts that pay out in them need a path that does not lock other users when one transfer fails.

## Practical rules

1. Check `eth_chainId` on every RPC you use; the testnet and mainnet RPCs are easy to swap by mistake.
2. Pin fork tests to a block number.
3. Explorer links: `https://robinhoodchain.blockscout.com/tx/<hash>` and `/address/<addr>`.
4. Copy stays factual: "on Robinhood Chain", never "by Robinhood"; add "Not affiliated with Robinhood."

## Sources and freshness

Compiled for Company.md on 2026-10-05 from the firm's build spec (SPEC.md §1), which cites Robinhood's chain
documentation (protocol contracts), the TrustSwap developer guide for RPCs, and
public deployment notes for the Uniswap v4 addresses. Addresses marked unverified must be confirmed with
`eth_getCode` before use; re-check this file whenever the chain announces an upgrade.
