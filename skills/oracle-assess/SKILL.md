---
id: oracle-assess
version: 1
kind: runnable
origin: parity
role: implement
inference: economy
tier: 2
judge: verifier-paths
requires: [network]
writes: none
checks: [no-writes, oracle-answer]
outputs:
  - path: artifacts/answer.json
    mediaType: application/json
    required: true
references: [public-rpcs, eth-robinhood-chain, eth-concepts, eth-addresses]
description: Answer a typed on-chain question from a pinned request, with the recipe that lets anyone reproduce the answer.
---

# Rulings: assess an oracle question

## Purpose

A ruling request ("Request a ruling") asks a typed question about chain state, for example "total supply of
token X at block N" or "did address A call function F in the window". A panel of seats answers it
independently; the ruling is signed only when the quorum's answers match exactly. Your answer is worth
nothing unless the recipe reproduces it: the Registrar re-executes the recipe against the chain before the
attester signs.

## Inputs

- `.company/reads/question.json`: `{ "requestId", "question", "chainId", "window": { "fromBlock",
  "toBlock" } | { "hours" }, "answerType": "bool" | "address" | "bytes32" | "uint256" | "address[]" |
  "bytes32[]", "head", "definitions", "guards", "toleranceBps", "allowAmbiguous" }`.
- A public RPC for the chain (see `public-rpcs`; Robinhood Chain from `eth-robinhood-chain`).

## Procedure

1. Pin the window: resolve `hours` into block numbers using block timestamps, and record the block hash of
   `toBlock`. All reads use explicit block numbers, never `latest`.
2. Apply `definitions` literally (for example what counts as "holder" or "volume"). If a term is undefined
   and two reasonable readings give different answers, the question is ambiguous.
3. Answer with the minimum set of reads: `eth_call` at a block, `eth_getLogs` over the window (split into
   ranges the RPC accepts), `eth_getBalance`, `eth_getStorageAt`. Cross-check against a second RPC.
4. Normalise the answer: lowercase hex for addresses and bytes32, decimal strings for uint256, sorted unique
   lists for arrays unless the question asks for order.
5. Write the recipe: each read as `{ "method", "params", "block" }` and the pure computation that turns the
   results into the answer, described precisely enough to re-implement.
6. If the question is ambiguous and `allowAmbiguous` is false, or a guard fails, answer with a status
   instead of a value.

## Outputs

`artifacts/answer.json`:
`{ "requestId", "status": "answered" | "ambiguous" | "refused", "answerType", "answer", "chainId",
"fromBlock": "N", "toBlock": "M", "blockHash": "0x...", "recipe": { "steps": [...], "compute": "..." },
"reason": "required when status is not answered" }`.

## Acceptance checks

1. `no-writes`: only `artifacts/` changed.
2. `oracle-answer`: `artifacts/answer.json` parses, its `answer` matches `answerType`, block numbers are
   ordered, and `recipe.steps` is non-empty (or `status` is `ambiguous`/`refused` with a `reason`).
3. The Registrar's re-execution of the recipe yields the same answer byte for byte (reproduction stage).
4. Your answer equals the quorum's when the chain data is unambiguous (panel agreement).

## Stop and report

Answer `refused` when the question asks for something not determinable from chain data (prices on an
off-chain venue, intentions, future events) or when the window is not yet final on the chain.
