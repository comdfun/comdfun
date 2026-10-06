---
id: deploy-script
version: 1
kind: runnable
origin: parity
role: implement
inference: standard
tier: 1
judge: verifier-rerun
requires: []
writes: paths
checks: [paths, foundry-build, foundry-test, foundry-script]
outputs: []
references: [eth-security, eth-robinhood-chain, eth-addresses]
description: Write a Foundry deployment script whose parameters all come from configuration, and prove it runs.
---

# Deployment script

## Purpose

Write `script/Deploy.s.sol` (or the name the matter gives) that deploys and wires the project with every
parameter supplied from environment variables or a JSON config file, never from literals. Prove it runs
by executing it in a test against forge's in-memory EVM. The Registrar will run the same script against
Robinhood Chain; a script that only works on the author's machine is not a deliverable.

## Inputs

- `.company/reads/matter.json`: objective, `paths` (the script, an optional `config/<chain>.json`, and a
  test file such as `test/Deploy.t.sol`).
- The contracts in `src/`, read-only.

## Procedure

1. List every constructor argument and post-deploy call (role grants, ownership transfers, parameter
   setters). Each becomes a named config value.
2. Read configuration with `vm.envUint`, `vm.envAddress`, `vm.envOr` or `vm.readFile` + `vm.parseJson*`.
   The deployer key comes only from `DEPLOYER_PRIVATE_KEY` passed to `vm.startBroadcast(pk)`.
3. Validate config before broadcasting: non-zero addresses, `block.chainid` equal to the configured chain,
   bounds on numeric parameters. Revert with a clear message otherwise.
4. Return deployed addresses as named return values of `run()` and also `console2.log` them with labels.
5. End with ownership in the configured final owner (often a multisig) and the deployer holding no roles.
   Assert that inside the script.
6. Write a test that sets env with `vm.setEnv`, runs the script, and asserts the resulting wiring:
   owners, roles, parameters, and that the deployer has no remaining privileges.
7. Run `forge build`, `forge test --offline`, and `forge script <script> --sig "run()"` without RPC to
   confirm a clean in-memory run.

## Outputs

The script, its optional config file(s) and its test, under the declared `paths`.

## Acceptance checks

1. `paths`: only the declared script, config and test files changed.
2. `foundry-build`: the script compiles.
3. `foundry-test`: the deployment test passes and asserts final ownership and the deployer's lack of roles.
4. `foundry-script`: a `script/*.s.sol` exists and contains no 32-byte hex literal (no embedded keys).
5. Every address the script uses comes from config; any address literal is a finding (cross-examiner).

## Stop and report

Stop when the contracts need wiring that cannot be done without a privileged EOA staying in control,
or when the target chain lacks a dependency the contracts assume (for example a Permit2 or PoolManager
deployment that `eth_getCode` shows is absent). Name the missing dependency and chain id.
