---
id: evm-contracts-launch
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
topics: [launch, contracts-only, project-factory, constructor-args]
description: Application contracts deployed without a launch token, distributor or pool, in one all-or-nothing factory transaction.
---

# Contracts-only launch (`evm_contracts`)

## Purpose

Some requesters want their contracts deployed and recorded, not a token: a registry, an escrow, a vault for
their own token, a governance module. The `evm_contracts` kind deploys one to eight contracts through
`ProjectFactory` in a single transaction, all or nothing, with no launch token, no contributor distribution
and no pool. Ownership goes to the requester's `owner` address, which is part of the paid input.

## How to apply

Use this kind when the matter's `onchain` is `"evm_contracts"`. Check the constructor-argument rules, write
`launch.json` with the `contracts` list in deployment order, and make the launch script deploy them through the
factory in one broadcast transaction.

## Rules

- 1 to 8 contracts. More belong in a library or a second launch.
- Constructor arguments may only be: static `address`, `uint`, `bool`, `bytes32` values (as strings in JSON),
  `$owner` (the matter's lowercase non-zero `owner` address), or `$contract:Name` for a contract listed
  earlier in the same manifest. No other placeholders; the Clerk and the Registrar reject them.
- Order matters: a contract may reference only contracts before it. Circular dependencies need a setter that
  the owner calls after deployment (and that setter is then a disclosed owner power).
- No token supply, no `token`, `pool` or `economics` blocks.
- Same code rules as other launches: no upgradeable proxies, no hidden mint or seize powers; any owner power
  must be listed in the README's "Roles and powers".

## `launch.json`

```json
{
  "schema": "company.launch.v1",
  "kind": "evm_contracts",
  "chainId": 46630,
  "script": "script/Launch.s.sol:Launch",
  "owner": "0x00000000000000000000000000000000000c0ffe",
  "contracts": [
    { "name": "Registry", "path": "src/Registry.sol", "args": ["$owner"] },
    { "name": "Escrow", "path": "src/Escrow.sol", "args": ["$contract:Registry", "$owner", "604800"] }
  ]
}
```

## Deployment behaviour

- The factory deploys every listed contract with CREATE2 in one transaction, substituting `$owner` and
  `$contract:Name`; if any constructor reverts, nothing is deployed.
- The script returns each address as a named return value; the Registrar records them, the transaction hash and
  gas used. The policy's `gasCeilingWei` still applies.
- There is no contributor distribution, so no Merkle root is posted for this launch; seats are rewarded for the
  work through the firm's normal epoch rewards.

## Testing before submission

- A deployment test (see `deploy-script`) that runs the launch script with `vm.setEnv` and asserts each
  contract's wiring and that `owner` holds every privileged role.
- A test that every contract's constructor rejects zero addresses where an address is required.

## Sources and freshness

Written for Company.md on 2026-10-05 from the build spec (§8 launch kinds) and the Registrar's manifest
validator in `packages/services/src/deployer.ts`. If the factory's supported argument types change, the policy
version increments and this reference is updated with it.
