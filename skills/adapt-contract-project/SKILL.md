---
id: adapt-contract-project
version: 1
kind: runnable
origin: parity
role: implement
inference: standard
tier: 1
judge: verifier-rerun
requires: []
writes: any
checks: [paths, foundry-build, foundry-test, launch-manifest]
outputs: []
references: [evm-project-launch, custom-token-launch, evm-contracts-launch, eth-security]
description: Make a requester's existing Foundry project launchable through ProjectFactory while changing as little of it as the launch requires.
---

# Adapt a contract project for launch

## Purpose

The requester arrives with a working Foundry project. This step makes it deployable by the Registrar
through `ProjectFactory`: a `launch.json` manifest, a launch script that follows our convention, and the
smallest set of source edits the launch kind demands (constructor-only configuration, no post-deploy
admin minting, factory-initialized pool). It does not refactor, restyle or "improve" the requester's
code. Every line you change is a line the cross-examiner will ask you to justify.

## Inputs

- `.company/reads/matter.json`: objective, `acceptanceCriteria`, `paths`, the launch kind requested
  (`custom_token`, `evm_project`, `univ4_hook` or `evm_contracts`), `chainId`, and for `custom_token`
  the `economics` block (`poolBps`, `initialMarketCapWei`, `remainderTo`).
- `.company/reads/policy.json`: the launch policy version the matter was admitted under (fee tiers,
  paired-currency allowlist, `gasCeilingWei`, owners).
- The repository at its pinned base commit. An `audit-imported-code` report may be attached as
  `.company/reads/findings.json`; you are not asked to fix it here unless the matter says so.

## Procedure

1. Run `forge build` and `forge test --offline` on the base tree and record the result. If the base does
   not build, stop (see below): adapting a broken project hides who broke it.
2. Read the reference skill for the launch kind (`evm-project-launch`, `custom-token-launch` or
   `evm-contracts-launch`) and list every requirement the project does not yet meet: constructor
   arguments instead of initializer calls, no `mint` reachable after construction, no owner-only
   functions over user balances, no `selfdestruct`/upgrade path, pool creation left to the factory.
3. For each gap make the narrowest edit that closes it. Prefer adding a constructor parameter over
   changing behaviour. Keep storage layout, public function signatures and events unchanged unless the
   requirement forces a change; when it does, note it in the commit message.
4. Write `launch.json` at the project root (schema `company.launch.v1`): `kind`, `chainId`, `script`,
   `contracts` with constructor `args` using only literals, `$owner` and `$contract:Name`, plus `token`,
   `pool` and `economics` where the kind needs them.
5. Write `script/Launch.s.sol` (or adapt the existing deploy script) to the Registrar convention: read
   `DEPLOYER_PRIVATE_KEY`, `PROJECT_FACTORY`, `LAUNCH_MANIFEST` and `CHAIN_ID` from env, call
   `vm.startBroadcast(pk)`, deploy through the factory, and return every deployed address as a named
   return value. No literal keys, no hard-coded chain addresses.
6. Add or update tests that prove the launch requirements: the token supply is fixed after deployment,
   the factory is the only caller able to initialize the pool, owners are the manifest's owners. Run
   `forge test --offline` until green.
7. Run `git diff --stat` against the base and re-read every hunk. Revert anything that is not required.

## Outputs

- `launch.json` at the project root.
- `script/Launch.s.sol` following the convention above.
- The minimal source and test edits. No files outside the project tree.

## Acceptance checks

1. `paths`: every change is inside the project tree and within the step's declared paths, if any.
2. `foundry-build`: the adapted project compiles with the project's pinned solc, offline.
3. `foundry-test`: the full suite passes, including the pre-existing tests (none deleted or skipped to
   get green) and at least one new test per launch requirement from step 2.
4. `launch-manifest`: `launch.json` validates against `company.launch.v1`, its kind matches the matter,
   and its `script` file exists.
5. Judged by the cross-examiner: the diff contains no behavioural change that the launch kind does not
   require, and every changed public signature is called out in the commit message.

## Stop and report

Stop and return a blocked result, without partial edits, when: the base tree does not build or its tests
fail; the project needs an upgradeable proxy, a post-deployment mint, a fee-on-transfer or blocklist
token, or any privileged control over user balances to function; the requested launch kind cannot be
met without rewriting core logic; or the policy's paired currency or chain is not the one the project
hard-codes.
