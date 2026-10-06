---
id: frontend-for-contract
version: 1
kind: runnable
origin: parity
role: implement
inference: premium
tier: 2
judge: verifier-paths
requires: [network]
writes: any
checks: [paths, web-build, site-screen]
outputs: []
references: [eth-frontend-ux, better-interface, eth-robinhood-chain, public-rpcs]
description: Build and validate a wallet-connected frontend for deployed contracts, delivering source and static export.
---

# Frontend for deployed contracts

## Purpose

In a workflow's frontend stage the contracts are already deployed and attested. This step builds the
static dApp that reads and writes them: Vite + React + TypeScript with viem/wagmi, configured for Robinhood
Chain (4663) or its testnet (46630). Addresses and ABIs come only from the deployment record; a frontend
with hand-typed addresses is rejected.

## Inputs

- `.company/reads/deployment.json`: `{ chainId, addresses: { Name: "0x..." }, abis: { Name: [...] },
  launchId, commit }`, written by the Registrar.
- `.company/reads/matter.json`: what users must be able to do, `acceptanceCriteria`, optional site label.
- References: `eth-frontend-ux` (flow and states), `eth-robinhood-chain` (chain definition and RPCs).

## Procedure

1. Copy `deployment.json` into the source as `src/deployment.json` unchanged, and generate typed ABIs
   from it. Ship it in the export as `dist/comd-deployment.json` so the Clerk can compare.
2. Define the chain with viem's `defineChain` (id, name, native ETH, RPC from `deployment.json` or the
   public RPC list, Blockscout explorer). Never put a private RPC key in the bundle.
3. Implement the read view first: all public state the user needs, with loading and error states, working
   without a wallet.
4. Implement writes with the full flow: connect, switch network, approve (exact amount by default; Permit2
   where the contract supports it), simulate (`simulateContract`), send, pending state with the transaction
   hash linked to the explorer, confirmation, refresh of affected reads, and decoded revert reasons.
5. Format amounts with each token's decimals (COMD has 18, stablecoins such as USDC 6), addresses shortened with copy and explorer link.
6. Add the footer line "Not affiliated with Robinhood." whenever Robinhood Chain is named on the page.
7. Build, serve `dist/`, exercise each flow against a local fork or the testnet if available, and save
   screenshots at 375 and 1280 px to `artifacts/screenshots/`.

## Outputs

Source tree, `src/deployment.json`, the built export containing `dist/comd-deployment.json`, and
screenshots under `artifacts/screenshots/`.

## Acceptance checks

1. `paths`: changes stay in the frontend project.
2. `web-build`: `npm ci && npm run build` produces `dist/index.html` in the Clerk's sandbox.
3. `site-screen`: no drainer patterns (no `eth_sign`, no unlimited approvals to hard-coded spenders), no
   scripts from unlisted hosts.
4. Every contract address in the bundle equals one in `deployment.json` (validation stage compares the
   published bytes with the deployment record).
5. Each write flow shows pending, success and failure states (cross-examiner, from screenshots or a run).

## Stop and report

Stop when `deployment.json` is missing, its chain id differs from the matter's, or `eth_getCode` shows no
code at a listed address. Report the address and chain.
