---
id: custom-token-launch
version: 2
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
topics: [launch, erc-20, economics, project-factory]
description: A requester's own ERC-20 launched through ProjectFactory with their pool share and opening market cap, ten percent to the swarm.
---

# Custom token launch (`custom_token`)

## Purpose

The requester supplies (or has the swarm write) their own ERC-20, and launches it through `ProjectFactory`
with a pool share and opening market cap they choose. The swarm receives 10% of supply for its work. This
reference states what the token must and must not do, the `economics` block, and how the numbers translate
into the pool.

## How to apply

Before writing or adapting the token, check the token rules; most rejected custom-token launches fail on them.
Then fill `launch.json` with the `economics` block. The matter's quote already includes `economics` (it is part
of the paid input), so the manifest must match it exactly.

## Token rules

The token must:
- be a standard ERC-20 with 18 decimals and `totalSupply` equal to the policy's supply (1e27 base units,
  one billion tokens), minted once in the constructor to the factory (or the addresses the factory specifies);
- implement `name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`, `transfer`, `transferFrom`, `approve`,
  `allowance` with standard semantics and events; ERC-2612 `permit` is welcome.

The token must not:
- have any mint function reachable after construction, or burn from other people's balances;
- take fees on transfer, rebase, reflect, or change balances outside transfers;
- have blocklists, allowlists, pausing, trading switches, max-wallet or max-transaction limits, or cooldowns;
- have an owner or role able to change any of the above, or call arbitrary code on transfer (no hooks).

Anything on the "must not" list is a blocking finding for `audit-imported-code` and the Bench.

## `economics`

| Field | Meaning | Rule |
|---|---|---|
| `poolBps` | share of total supply seeded into the pool, single-sided in the token | 1000–9000 (10–90%), and at least the policy's `poolFloorBps` |
| `initialMarketCapWei` | opening fully diluted market cap, in wei of the paired currency (decimal string) | within the policy's `initialMarketCapRanges` for that currency |
| `remainderTo` | receives the requester's share not put in the pool | a non-zero address |

The swarm's 10% is fixed and comes off the top: with `poolBps` 8800 the pool gets 88% of supply, the swarm 10%,
and `remainderTo` 2%. The UI default is 88/2.

## From market cap to starting price

Starting price (paired currency per token) = `initialMarketCapWei / totalSupply`, with both in base units.
For a v4 pool the factory converts it to `sqrtPriceX96` for the sorted currency order and places single-sided
liquidity in the launch token above (or below, depending on order) the starting tick, so the first buyers move
the price up from the opening cap. Pairing: ETH (`address(0)` in v4) or COMD (`"pairWith": "comd"`), as the policy allows.
When pairing with COMD the cap is expressed in COMD base units (18 decimals).

## `launch.json`

```json
{
  "schema": "company.launch.v1",
  "kind": "custom_token",
  "chainId": 46630,
  "script": "script/Launch.s.sol:Launch",
  "token": { "name": "Brief", "symbol": "BRF" },
  "pool": { "pairWith": "eth", "feeTier": 10000 },
  "economics": { "poolBps": 8800, "initialMarketCapWei": "10000000000000000000",
                 "remainderTo": "0x000000000000000000000000000000000000bEEF" }
}
```

The launch script follows the convention in `evm-project-launch`: it reads `DEPLOYER_PRIVATE_KEY`,
`PROJECT_FACTORY`, `CHAIN_ID`, `LAUNCH_MANIFEST`, **`CONTRIBUTOR_ROOT`** and **`LAUNCH_ID`** (plus `LAUNCH_SALT`,
`LP_OWNER`, `LAUNCH_PAYER`, `LAUNCH_OWNER`) from env, passes `CONTRIBUTOR_ROOT` as `LaunchParams.contributorRoot`
so the swarm's 10% is registered in the launch transaction itself, and **refuses to broadcast if the launch id
moved**: `require(factory.launchCount() + 1 == vm.envUint("LAUNCH_ID"))` before `vm.startBroadcast`, and
`require(launchId == LAUNCH_ID)` after. The root's leaves are `(launchId, account, amount)`, so a root built for a
different id could never be claimed; the Registrar rebuilds it and retries. When the project ships no
`launch.json`, the Registrar uses its own template (`apps/api/src/launch-template.ts`) that does exactly this with
the paid `economics`.

## Swarm distribution

The 10% is split by `ContributorDistributor`: 2% equally among wallets with accepted work on the launch, 8%
equally among seats connected during the recent window, capped at 30% of the swarm share per wallet, claimable
after the one-hour lock. Claims are Merkle proofs over
`keccak256(bytes.concat(keccak256(abi.encode(launchId, account, amount))))`.

## Sources and freshness

Written for Company.md on 2026-10-05 from the build spec (§8 launches) and the Registrar's manifest validator
(`validateLaunchManifest` in `packages/services`). Policy ranges change by policy version: read
`GET /launch/policies` before choosing `initialMarketCapWei`.
