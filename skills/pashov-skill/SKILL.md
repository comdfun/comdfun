---
id: pashov-skill
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
topics: [audit-method, specialties, finding-validation, severity]
description: A specialty-based Solidity audit method with evidence-based finding validation, in the style of Pashov Audit Group.
---

# Specialty-based audit method

## Purpose

The method the Bench follows: split the code's risk into specialties, examine each in depth, and admit only
findings that survive validation. The approach is modelled on how Pashov Audit Group describes its public
audit practice (multiple specialists, structured specialties, evidence before severity); this text is the
firm's own description of it, not their material.

## How to apply

Bench specialists take one or more specialties from the list (the Managing Partner assigns them through
`variables.area`). Each specialty has a set of questions; work through them against the scope, then validate
every candidate finding with the five-part test below before writing it. The chief justice uses the same
test to rule.

## Preparation

1. Freeze scope: commit hash, list of files, compiler version, deployment target. Out-of-scope dependencies
   are assumed correct only for behaviour they document.
2. Read the documentation and tests first; write down the intended invariants and roles.
3. Build and run the suite; note gaps in coverage as leads.
4. Produce the entry-point map (see `tob-entry-point-analyzer`).

## Twelve specialties

| # | Specialty | Central questions |
|---|---|---|
| 1 | Access control and roles | Can anyone call what only the owner should? Can roles be escalated or locked out? |
| 2 | Arithmetic and precision | Units, rounding direction, overflow in casts and `unchecked`, divide-before-multiply, zero cases |
| 3 | Reentrancy and external calls | State updated before calls? Callbacks from tokens, hooks, receivers? Read-only reentrancy for integrators? |
| 4 | Token integration | Fee-on-transfer, rebasing, missing return values, 6-decimal tokens, freezable stablecoins, ERC-777 hooks |
| 5 | Oracles and pricing | Manipulable spot prices, staleness, decimals of feeds, L2 sequencer uptime |
| 6 | Economic and incentive design | Can someone profit by sandwiching, first-depositing, donating, or timing a reward? Are keepers paid? |
| 7 | Denial of service and gas | Unbounded loops, failing recipients in batches, griefing with dust, block gas limits |
| 8 | Signatures and replay | Nonces, deadlines, domain separation, malleability, ERC-1271, cross-chain replay |
| 9 | Upgradeability and initialisation | Initialisers, storage layout, upgrade authority, constructor vs initializer |
| 10 | State machine and logic | Every state transition allowed only from valid states; edge sequences like claim-before-start |
| 11 | AMM and hook integration | Slippage and deadlines, pool key assumptions, v4 deltas and callbacks (see `uniswap-v4-security`) |
| 12 | Chain and deployment specifics | L2 differences (`block.number` on Arbitrum chains), addresses per chain, deploy scripts, final ownership |

## Working a specialty

- List the code relevant to the specialty (functions, storage, modifiers).
- For each central question, find the code that answers it and cite the line. "Not applicable" needs a reason.
- Use the failure-mode catalog in `pashov-xray` as a checklist of known patterns for the specialty.
- Think in sequences, not single calls: what does a call do when preceded by another particular call, in the
  same block, by the same or another actor, possibly with borrowed capital?

## Five-part validation of a finding

A candidate becomes a finding only when you can write all five:

1. **Location**: file and line(s).
2. **Preconditions**: the state and roles needed (and how likely they are).
3. **Sequence**: the exact calls, with values, that trigger it.
4. **Impact**: what is lost, locked or broken, for whom, how much.
5. **Proof**: a Foundry test that demonstrates it, or a reasoning chain tight enough that a reader can write
   that test without guessing.

Candidates failing any part are recorded as "considered, not reproduced" rather than reported.

## Severity

| | High likelihood | Medium likelihood | Low likelihood |
|---|---|---|---|
| High impact (funds stolen or permanently locked, protocol insolvent) | Critical | High | Medium |
| Medium impact (bounded loss, temporary lock, broken non-core function) | High | Medium | Low |
| Low impact (minor, self-inflicted, cosmetic) | Medium | Low | Low |

Likelihood is high when any user can trigger it at negligible cost; medium with preconditions or capital;
low when it needs a privileged mistake. State both axes in the finding's evidence.

## Writing findings

Title states the effect and the cause ("Withdraw can be re-entered to double-claim because balance is updated
after transfer"). Recommendations are minimal and specific; when several fixes exist, give the simplest safe one.
No finding is padded with generic advice.

## Sources and freshness

Written for Company.md in 2026, summarising in the firm's own words the publicly described practice of
Pashov Audit Group and similar specialist audit teams (their open skills repository and public reports), and
standard impact × likelihood severity matrices. The specialty list is the firm's own grouping and may be
revised as the Bench gains experience.
