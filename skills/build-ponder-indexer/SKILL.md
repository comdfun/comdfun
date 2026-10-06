---
id: build-ponder-indexer
version: 1
kind: runnable
origin: parity
role: implement
inference: standard
tier: 2
judge: verifier-paths
requires: [network]
writes: any
checks: [paths, indexer, npm-check]
outputs: []
references: [public-rpcs, eth-robinhood-chain, eth-concepts]
description: Build a Ponder indexer for specific contracts so their events are queryable as tables and GraphQL.
---

# Build a Ponder indexer

## Purpose

Deliver a Ponder project that indexes the events of named contracts on a named chain into tables, exposed
through Ponder's GraphQL and SQL APIs. It must start from a known block, survive reorgs (Ponder handles
them when handlers are pure functions of events and reads at the event's block), and run with only an RPC
URL supplied by environment.

## Inputs

- `.company/reads/matter.json`: contracts (address, chain id, start block or deployment tx), the questions
  the data must answer, `acceptanceCriteria`.
- ABIs in `.company/reads/deployment.json` or `.company/reads/inputs/*.json`.

## Procedure

1. Scaffold with `npm create ponder` (TypeScript). Commit `package-lock.json`.
2. `ponder.config.ts`: one chain entry per chain id with `rpc: process.env.PONDER_RPC_URL_<chainId>`; one
   contract entry per contract with ABI, address and `startBlock` (the deployment block, never 0 on a busy
   chain). For Robinhood Chain use chain id 4663 (testnet 46630).
3. `ponder.schema.ts`: tables keyed by natural ids (`chainId`, tx hash + log index for event rows, address
   for account rows). Store amounts as `bigint`, never floats.
4. `src/index.ts`: one handler per event. Handlers derive state only from the event and from `context.client`
   reads pinned to the event's block. No network calls to other services.
5. Add `typecheck` (`tsc --noEmit`) and `test` scripts; write at least one unit test for any non-trivial
   transformation (for example decimals scaling).
6. Write `README.md`: env vars, how to run `ponder dev` and `ponder start`, example GraphQL queries that
   answer the matter's questions.

## Outputs

The Ponder project: `package.json`, `package-lock.json`, `ponder.config.ts`, `ponder.schema.ts`,
`src/*.ts`, `abis/*.ts`, `README.md`, `.env.example`.

## Acceptance checks

1. `paths`: changes stay in the project tree.
2. `indexer`: `ponder.config.ts`, `ponder.schema.ts`, handlers in `src/` and a `ponder` dependency exist.
3. `npm-check`: `npm ci`, `npm run typecheck` and `npm test` pass in the Clerk's sandbox.
4. Every event the matter names has a handler, and every start block is the deployment block
   (cross-examiner checks against the explorer).
5. No RPC URL or key is committed; `.env.example` lists every variable (cross-examiner).

## Stop and report

Stop when a contract address has no code on the named chain, when the ABI does not contain the named
events, or when the questions require data that is not emitted or readable on chain.
