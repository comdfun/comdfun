---
id: solidity-security-review
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
topics: [threat-model, review, solidity]
description: A lightweight Solidity threat-model reference for a scoped review; it does not create a review assignment by itself.
---

# Solidity threat model for a scoped review

## Purpose

Gives a reviewer (or an implementer checking their own work) a fast, structured way to build a threat model
for a small scope: a diff, a single contract, a new function. It complements `eth-security` (the item
checklist) with the questions that decide which items matter. Attaching it to a step adds context only; it
does not seat a reviewer. Reviews happen through `adversarial-review` or the Bench.

## How to apply

Before reading code line by line, fill in the four tables below for the scope, in a scratch file or in your
head. Then read the code against them. Every finding you write should name the asset at risk and the actor
who can reach it; if you cannot name both, the finding is probably not real.

## 1. Assets

What can be lost, locked or misallocated if this code is wrong?

| Asset | Where it lives | Who should be able to move it |
|---|---|---|
| Token balances held by the contract | `balanceOf(this)` and internal ledgers | users via withdraw, protocol via fees |
| Accounting state | shares, debt, rewards per token, nonces | only the contract's own logic |
| Privileges | owner, roles, allowlists, pausers | the governance process, never users |
| Liveness | the ability to withdraw, liquidate, settle | everyone, always |

Losing liveness (funds stuck) is as serious as theft when it is permanent.

## 2. Actors

| Actor | Capabilities |
|---|---|
| Anonymous user | any call, any order, any amount, flash loans, many addresses |
| Token holder or depositor | the above plus balances in the system |
| Privileged role | admin functions; may be compromised or malicious |
| Integrator contract | calls you from inside its own logic; may reenter |
| Block producer / sequencer | ordering, inclusion delay; on L2 a centralised sequencer |
| External dependency | the token, oracle, pool or bridge you call; may misbehave within its interface |

## 3. Trust boundaries

Draw each place where control or data crosses from one actor to another: every external call (out), every
callback (in), every oracle read, every signature verification, every admin setter. Each boundary is where
assumptions get violated. For each one write the assumption ("the token returns true or reverts", "the price
is at most 1 hour old", "the hook is only called by the PoolManager").

## 4. Invariants

State the properties that must hold after every transaction in plain terms:

- Conservation: sum of user balances equals the contract's holding (or is less, with the difference
  explained by fees).
- Monotonicity: share price does not decrease except by a documented loss path.
- Authorisation: only role X changes parameter Y; parameters stay within bounds.
- Liveness: a user with a positive balance can always withdraw unless a documented pause is active.

Each invariant is a candidate invariant test and a lens for reading code.

## Reading the code against the model

1. For each entry point (see `tob-entry-point-analyzer`), ask which assets it touches and which invariants
   it could break.
2. For each trust boundary, ask what happens if the assumption fails: the token takes a fee, the callback
   reenters, the oracle is stale, the signer is a contract.
3. For each privileged function, ask what the worst holder of that role could do in one transaction, and
   whether users can exit first.
4. For each arithmetic expression on assets, check units, rounding direction and the zero case.

## Severity in one paragraph

Impact: high when funds can be stolen or permanently locked, or core functionality fails for all users;
medium when loss is bounded, conditional or temporary; low when the effect is cosmetic or self-inflicted.
Likelihood: high when any user can trigger it cheaply; medium with preconditions or capital; low when it
needs a privileged mistake or improbable state. Combine them and say how you combined them.

## Sources and freshness

Written for Company.md in 2026, drawing on general threat-modelling practice (assets, actors, boundaries,
invariants) as applied in public smart-contract audit reports. It contains no chain-specific facts and does
not age quickly; review it when the firm's severity policy changes.
