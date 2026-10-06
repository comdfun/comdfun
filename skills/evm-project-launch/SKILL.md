---
id: evm-project-launch
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
topics: [launch, project-factory, launch-policy, contributor-distribution, univ4-hook]
description: Constructor-only EVM projects launched with a token and a factory-initialised pool through ProjectFactory, under launch policy.
---

# EVM project launch (`evm_project`, `univ4_hook`)

## Purpose

How a project built by the swarm becomes a deployed project with its own launch token and a liquidity pool:
what the code must look like to be launchable, what `launch.json` and the launch script contain, what the
Registrar does with them under the launch policy, and where the tokens go. Read by `adapt-contract-project`,
`build-contract-project` and `deploy-script` seats on launch matters, by the Bench, and by the planner.

## How to apply

Check the project against the "launchable code" rules before anything else; those failures cannot be fixed at
deployment. Then write the manifest and script exactly as specified. The Registrar runs the script itself;
seats never deploy to Robinhood Chain on a matter's behalf.

## Lifecycle

1. **contracts**: implementation, tests and cross-examination run; `launch.json` is written.
2. **audit**: the Bench (four `audit-specialist` + `audit-judge`) rules; blocking findings go to `fix-findings`.
3. **deployment**: the Records Office files the source to GitHub; the Registrar rebuilds from that commit,
   attests the build, runs admission checks against the policy, then `forge script` with its deployer key
   through `ProjectFactory`. A gas ceiling and a circuit breaker apply.
4. **frontend / publishing / validating** (workflows): a frontend reads `.company/reads/deployment.json`; the
   site is hosted at `https://<label>.sites.comd.fun`; validation compares published bytes, ABIs and on-chain
   code with the record.

## Launchable code

- Constructor-only configuration: everything the project needs is set in constructors (or by the factory in the
  same transaction). No `initialize` left callable afterwards.
- Fixed supply: the launch token is minted once at construction (to the factory for distribution). No `mint`
  reachable after deployment, no owner powers over balances or transfers, no transfer fees, no blocklists,
  no pause on transfers.
- Immutable: no proxies, no `delegatecall` to upgradeable logic, no `selfdestruct` paths.
- Pool initialisation is the factory's alone: the project does not create or seed its own pool. For `univ4_hook`
  launches the hook's `beforeInitialize` must accept the factory-initialised canonical key and reject others
  (see `uniswap-v4-security`).
- Owners come from the policy's `owners` (`token`, `project`, `treasury`, `hookAdmin`, `lpPosition`), passed
  through the manifest as `$owner`; no EOA of the author ends up privileged.

## `launch.json` (schema `company.launch.v1`)

```json
{
  "schema": "company.launch.v1",
  "kind": "evm_project",
  "chainId": 46630,
  "script": "script/Launch.s.sol:Launch",
  "contracts": [
    { "name": "Registry", "path": "src/Registry.sol", "args": ["$owner"] },
    { "name": "Rewards", "path": "src/Rewards.sol", "args": ["$contract:Registry", "86400"] }
  ],
  "token": { "name": "Docket Token", "symbol": "DOCKET" },
  "pool": { "pairWith": "eth", "feeTier": 3000, "hook": "DocketHook" }
}
```

Constructor arguments may be literals (address, uint, bool, bytes32 as strings), `$owner`, or
`$contract:Name` for a contract deployed earlier in the same launch. `pool.hook` names the hook contract for
`univ4_hook` launches.

## Launch script convention

`script/Launch.s.sol` with a `run()` that:
- reads every per-deployment value from env, never from literals. The Registrar sets:

  | Env | Meaning |
  |---|---|
  | `DEPLOYER_PRIVATE_KEY` | the Registrar's key (`REGISTRAR_ROLE` on `ProjectFactory`); broadcast with it |
  | `PROJECT_FACTORY` | the `ProjectFactory` address |
  | `LAUNCH_MANIFEST` | absolute path to `launch.json` |
  | `CHAIN_ID` | the launch chain; `require(block.chainid == vm.envUint("CHAIN_ID"))` |
  | `LAUNCH_ID` | the launch id this deployment must get: `ProjectFactory.launchCount() + 1` when the root was built |
  | `CONTRIBUTOR_ROOT` | `bytes32` Merkle root of the swarm's 10%, passed as `LaunchParams.contributorRoot` |
  | `LAUNCH_SALT` | `bytes32` CREATE2 salt, passed as `LaunchParams.salt` |
  | `LP_OWNER` | the policy's `owners.lpPosition` (zero = factory default), passed as `LaunchParams.lpOwner` |
  | `LAUNCH_PAYER`, `LAUNCH_OWNER` | the paying wallet and the policy's project owner, for `$owner` / remainder wiring |

- **refuses to broadcast if the launch id moved**: before `vm.startBroadcast`,
  `require(factory.launchCount() + 1 == vm.envUint("LAUNCH_ID"), "launchId moved: rebuild the contributor root")`,
  and after the launch `require(launchId == LAUNCH_ID)`. The contributor root's leaves are
  `(launchId, account, amount)`, so a root built for another id would be unclaimable; the Registrar rebuilds the
  root and retries instead.
- registers the swarm's share in the same transaction: `ProjectFactory.launch(params)` with
  `params.contributorRoot = CONTRIBUTOR_ROOT`. Nothing posts the root afterwards.
- calls `vm.startBroadcast(pk)` and deploys through `ProjectFactory` (deterministic CREATE2 so addresses are
  known before broadcast);
- returns every deployed address as a named return value (`returns (address token, address factory, ...)`): the
  Registrar records them from the script's JSON output, the broadcast file and the `Launched` event.

No literal keys or chain addresses; the Clerk's `foundry-script` check rejects 32-byte hex literals. A minimal
skeleton (the Registrar's own template, `apps/api/src/launch-template.ts`, needs no forge-std):

```solidity
function run() external returns (address token, address factory) {
    require(block.chainid == vm.envUint("CHAIN_ID"), "wrong chain");
    uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
    factory = vm.envAddress("PROJECT_FACTORY");
    uint256 expected = vm.envUint("LAUNCH_ID");
    require(IProjectFactory(factory).launchCount() + 1 == expected, "launchId moved: rebuild the contributor root");
    IProjectFactory.LaunchParams memory p = /* kind, name, symbol, paired, fee, hook, economics … */;
    p.contributorRoot = vm.envBytes32("CONTRIBUTOR_ROOT");
    p.salt = vm.envBytes32("LAUNCH_SALT");
    p.lpOwner = vm.envAddress("LP_OWNER");
    vm.startBroadcast(pk);
    (uint256 launchId, address t) = IProjectFactory(factory).launch(p);
    vm.stopBroadcast();
    require(launchId == expected, "unexpected launchId");
    token = t;
}
```

## Policy and admission

Policies are versioned rows (`GET /launch/policies`). Parameters the Registrar enforces:
`chainId`; `feeTiers` [500, 3000, 10000]; `totalSupply` 1e27 (1 billion with 18 decimals);
`treasuryBps` 1000; `liquidityBps` 8000; `contributorPoolBps` 1000; `recentContributorBps` 800;
`recentContributorWindowSeconds` 43200 or 86400; `contributorLockSeconds` 3600; `perWalletCapBps` 3000;
`poolFloorBps` 1000; `gasCeilingWei`; `pairedCurrencyAllowlist` [ETH, COMD];
`initialMarketCaps` per paired currency; `owners`. Admission refuses a manifest whose chain, kind, fee tier or
paired currency is outside the policy, and the deployment stops if the estimated gas cost exceeds
`gasCeilingWei`.

## Where the tokens go

- 10% of supply to the swarm through `ContributorDistributor` (a Merkle root per launch): 2% split equally
  among wallets with accepted work on the launch, 8% split equally among seats connected in the recent window
  (`equal_connected`); no wallet above 30% of the swarm share; claims unlock after one hour.
- The requester's 90%: `poolBps` (10–90% of supply) seeds the pool single-sided in the launch token; the rest
  goes to the wallet that paid (UI default 88% pool, 2% payer).
- The LP position belongs to the policy's `lpPosition` owner.

## Sources and freshness

Written for Company.md on 2026-10-05 (launch-script env and launch-id guard: 2026-10-06) from the firm's build spec (§8 launches) and the Registrar's
implementation (`packages/services/src/deployer.ts`, `validateLaunchManifest`). ProjectFactory's ABI is
exported by `@company/abi`; when it changes, the policy version increments and this file must be updated.
