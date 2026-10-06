---
id: eth-l2s
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
topics: [l2, rollups, arbitrum, op-stack, zk]
description: The L2 landscape for builders: rollup families, behaviour that differs from Ethereum, and where Robinhood Chain fits.
---

# The L2 landscape

## Purpose

Most matters deploy on Robinhood Chain, an L2; many research and oracle questions touch other L2s. Code that
is correct on Ethereum can misbehave on an L2 because block numbers, timestamps, gas, precompiles and
cross-chain messages differ. This reference maps the families and the differences that bite.

## How to apply

Identify the chain's family first (Arbitrum Nitro/Orbit, OP Stack, ZK rollup, other), then read the matching
section and the "differences" checklist. For Robinhood Chain specifics read `eth-robinhood-chain`; for RPC
endpoints `public-rpcs`.

## Families

| Family | Examples | Proof system | Notes |
|---|---|---|---|
| Arbitrum Nitro / Orbit | Arbitrum One (42161), Arbitrum Nova (42170), Robinhood Chain (4663) | optimistic, interactive fraud proofs | Orbit chains are app-specific chains built on the Nitro stack |
| OP Stack (Superchain) | OP Mainnet (10), Base (8453), Unichain (130), World Chain (480), Ink (57073), Soneium (1868), Zora (7777777), Mode (34443) | optimistic, fault proofs | shared predeploys at `0x4200…` addresses |
| ZK rollups, EVM-equivalent or close | Linea (59144), Scroll (534352) | validity proofs | small opcode or precompile differences; check docs |
| ZK rollups, different VM | zkSync Era (324) | validity proofs | separate compiler (zksolc), different CREATE2 address derivation |
| Not EVM | Starknet | validity proofs | Cairo; out of scope for Foundry matters |

Maturity is tracked by L2BEAT "stages" (0, 1, 2) by how much users depend on operators and security councils.

## Differences from Ethereum that bite

- `block.number`: on Arbitrum chains it returns an estimate of the parent chain's block number, not the L2
  block; use `ArbSys(address(0x64)).arbBlockNumber()` for the L2 block. On OP Stack it is the L2 block number.
  Use `block.timestamp` for durations on any L2.
- Block times are short (around 250 ms on Arbitrum One, 2 s on OP Stack chains); never assume 12 s blocks.
- `block.prevrandao` / `difficulty` is not randomness on L2s (a constant on Arbitrum). Use a VRF or
  commit-reveal.
- Gas: total fee = L2 execution + a parent-chain data component. On Arbitrum the receipt's gas used includes
  the data part (`gasUsedForL1`); on OP Stack the L1 fee is charged separately (`GasPriceOracle` at
  `0x420000000000000000000000000000000000000F`). Gas estimates from L1 tooling can be wrong.
- Opcode support follows the chain's upgrade level: `PUSH0` (Shanghai), `TSTORE/TLOAD/MCOPY` (Cancun),
  EIP-7702 (Pectra). Check the chain's version before using a recent opcode; compile with the matching
  `evm_version`.
- Precompiles and predeploys: Arbitrum `ArbSys` 0x64, `ArbGasInfo` 0x6c, `ArbRetryableTx` 0x6e; OP Stack
  `L1Block` 0x4200000000000000000000000000000000000015, `L2CrossDomainMessenger` 0x4200…0007,
  `L2StandardBridge` 0x4200…0010, `WETH` 0x4200…0006.
- Cross-chain messages from L1 arrive from an aliased sender: L1 address + `0x1111000000000000000000000000000000001111`
  on both Arbitrum and OP Stack. Undo the alias before authorising.
- Sequencer downtime: users may be unable to transact while the sequencer is down, then a backlog lands at once.
  Lending and liquidation logic should consult a sequencer uptime feed and allow a grace period.

## Withdrawals and finality

- Optimistic rollups: messages to L1 wait for the challenge window (about seven days by default) before they
  can be executed on L1. Fast bridges front the liquidity for a fee.
- ZK rollups: final once the proof is verified on L1 (hours rather than days).
- For UX on the L2 itself, the sequencer's soft confirmation is effectively final; reorgs are rare but possible
  before batch posting.

## Deploying across L2s

- CREATE2 with the same deployer, salt and initcode yields the same address on EVM-equivalent chains (not on
  zkSync). Deterministic deployers (`0x4e59b44847b379578588920cA78FbF26c0B4956C`) may or may not exist on a
  new chain: verify with `eth_getCode`.
- Protocol addresses differ per chain (USDC, WETH, Uniswap). Never copy an address from another chain; see
  `eth-addresses`.

## Sources and freshness

Written for Company.md in 2026 from Arbitrum, OP Stack, zkSync, Linea and Scroll developer documentation and
L2BEAT. Chain ids are stable; block times, fee formulas, upgrade levels and stage ratings change. Verify chain
ids with `eth_chainId` and opcode support against the chain's current release notes before relying on them.
