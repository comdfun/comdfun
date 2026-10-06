---
id: public-rpcs
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
topics: [rpc, chain-ids, json-rpc, rate-limits]
description: Public JSON-RPC endpoints and chain ids for Robinhood Chain and major EVM chains, ordered for rotation.
---

# Public RPC endpoints

## Purpose

Seats answering ruling questions, building indexers or testing frontends need RPC access without the firm's
private keys. This reference lists public endpoints in the order the firm rotates through them, and the rules
that keep results reproducible when public nodes disagree or throttle.

## How to apply

Use the first endpoint for the chain; on errors or throttling move to the next. Always confirm `eth_chainId`
matches before trusting a response. For anything that will be signed or published (ruling answers,
deployments), read at an explicit block number and cross-check with a second endpoint.

## Robinhood Chain

| Chain | Id | Endpoints |
|---|---|---|
| Robinhood Chain | 4663 | `https://rpc.mainnet.chain.robinhood.com` |
| Robinhood Chain Testnet | 46630 | `https://rpc.testnet.chain.robinhood.com` |

Only one public endpoint per network was known when this was written; treat rate limits conservatively.

## Major chains

| Chain | Id | Endpoints, in rotation order |
|---|---|---|
| Ethereum | 1 | `https://ethereum-rpc.publicnode.com`, `https://eth.llamarpc.com`, `https://eth.drpc.org` |
| Sepolia | 11155111 | `https://ethereum-sepolia-rpc.publicnode.com`, `https://sepolia.drpc.org` |
| Hoodi (Ethereum testnet) | 560048 | `https://ethereum-hoodi-rpc.publicnode.com` |
| Arbitrum One | 42161 | `https://arb1.arbitrum.io/rpc`, `https://arbitrum-one-rpc.publicnode.com` |
| Arbitrum Sepolia | 421614 | `https://sepolia-rollup.arbitrum.io/rpc`, `https://arbitrum-sepolia-rpc.publicnode.com` |
| Arbitrum Nova | 42170 | `https://nova.arbitrum.io/rpc` |
| Base | 8453 | `https://mainnet.base.org`, `https://base-rpc.publicnode.com` |
| Base Sepolia | 84532 | `https://sepolia.base.org`, `https://base-sepolia-rpc.publicnode.com` |
| OP Mainnet | 10 | `https://mainnet.optimism.io`, `https://optimism-rpc.publicnode.com` |
| OP Sepolia | 11155420 | `https://sepolia.optimism.io` |
| Unichain | 130 | `https://mainnet.unichain.org` |
| Polygon PoS | 137 | `https://polygon-rpc.com`, `https://polygon-bor-rpc.publicnode.com` |
| Polygon Amoy | 80002 | `https://rpc-amoy.polygon.technology` |
| BNB Smart Chain | 56 | `https://bsc-dataseed.bnbchain.org`, `https://bsc-rpc.publicnode.com` |
| Avalanche C-Chain | 43114 | `https://api.avax.network/ext/bc/C/rpc`, `https://avalanche-c-chain-rpc.publicnode.com` |
| Gnosis | 100 | `https://rpc.gnosischain.com`, `https://gnosis-rpc.publicnode.com` |
| Linea | 59144 | `https://rpc.linea.build` |
| Scroll | 534352 | `https://rpc.scroll.io` |
| zkSync Era | 324 | `https://mainnet.era.zksync.io` |
| Blast | 81457 | `https://rpc.blast.io` |
| Celo | 42220 | `https://forno.celo.org` |
| Mantle | 5000 | `https://rpc.mantle.xyz` |

Chainlist (chainlist.org) aggregates many more; its entries are community-submitted, so apply the same
`eth_chainId` check.

## Rules for reliable reads

- Pin blocks. `latest` differs between nodes by a few blocks; a ruling read at `latest` cannot be reproduced.
  Resolve the block once, then pass it to every call.
- `eth_getLogs` limits: public nodes cap block ranges (often 1,000–10,000 blocks) and result counts. Split
  ranges, and on a "too many results" error halve the range and retry.
- Archive state: old-block `eth_call` and `eth_getBalance` need an archive node; many public endpoints prune.
  If a historical read fails with "missing trie node", switch endpoints rather than changing the block.
- Batch with Multicall3 or JSON-RPC batches, but keep batches modest (tens of calls); some endpoints reject
  large batches.
- Back off on HTTP 429 with exponential delay and jitter; rotate after repeated failures.
- Never send private keys or signed secrets to a public RPC beyond what a transaction broadcast requires. For
  broadcasting, the Registrar uses its own configured endpoint.

## Verifying an endpoint

```bash
curl -s -X POST <rpc> -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# expect the chain id in hex, e.g. 0x1237 for 4663 and 0xb626 for 46630
```

## Sources and freshness

Compiled for Company.md in 2026 from chain operators' documentation, the publicnode and dRPC endpoint lists,
and Chainlist. Public endpoints come and go without notice; chain ids do not. Verify each endpoint before a
run and report dead ones so the list can be updated.
