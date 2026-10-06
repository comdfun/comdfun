---
id: pashov-fizz
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
topics: [invariant-discovery, properties, foundry-invariants, handlers]
description: Invariant discovery and property patterns, applied with Foundry handler-based invariant tests.
---

# Invariant discovery and property patterns

## Purpose

Fuzzing finds what you ask it to look for. This reference covers the step before writing an invariant suite:
discovering which properties a system should satisfy, and the patterns for expressing them so a Foundry
invariant run can falsify them. It follows the idea behind Pashov Audit Group's "fizz" approach (systematic
invariant discovery feeding fuzzing), in the firm's own words.

## How to apply

Used by `write-foundry-tests` seats on value-holding contracts and by matters with `template: "fuzz"`. Run the
discovery passes, write the properties in plain English in the test file header, then implement them with the
handler pattern below. For mechanics of Foundry configuration see `eth-testing`.

## Discovery passes

Go through the code five times, each time asking one question, and write every answer as a candidate property:

1. **Storage pass**: for each storage variable, what values may it hold, and how does it relate to others?
   ("`totalSupply` equals the sum of `balanceOf`", "`claimed[epoch][id]` only goes false to true".)
2. **Function pass**: for each external function, what is true before and after? (pre/postconditions,
   including what must not change.)
3. **Actor pass**: for each actor type, what can they never achieve? ("a user never withdraws more than they
   deposited plus their share of yield", "a non-owner never changes fees".)
4. **Value pass**: follow every token flow in and out; write the conservation equation.
5. **Time pass**: what must hold across time? (monotone indexes, eventual claimability, no stuck funds after
   all actors exit.)

Discard candidates that are not checkable from state the test can read; keep a ghost variable in the handler
when the property needs history.

## Property patterns

| Pattern | Shape | Example |
|---|---|---|
| Conservation | inputs = outputs + held | deposits − withdrawals = vault balance − yield |
| Bound | x within [lo, hi] | fee bps ≤ max; cap ≥ floor |
| Monotonicity | x never decreases | reward index, share price outside losses, nonce |
| Uniqueness | at most once | each Merkle leaf claimed once |
| Round trip | f⁻¹(f(x)) ≈ x with known loss | deposit then redeem returns ≤ deposit and ≥ deposit − 1 wei per share |
| Equivalence | system = simple model | ledger matches a mapping maintained in the handler |
| Liveness | an action always succeeds when allowed | full withdrawal by any holder never reverts |
| Access | only R changes P | parameter unchanged by any non-R handler action |

## Handler pattern in Foundry

```solidity
contract VaultHandler is Test {
    Vault vault; MockERC20 asset;
    address[] actors; uint256 public ghostDeposited; uint256 public ghostWithdrawn;

    function deposit(uint256 actorSeed, uint256 amount) external {
        address a = actors[bound(actorSeed, 0, actors.length - 1)];
        amount = bound(amount, 1, 1e30);
        asset.mint(a, amount);
        vm.startPrank(a); asset.approve(address(vault), amount); vault.deposit(amount, a); vm.stopPrank();
        ghostDeposited += amount;
    }
    // withdraw, transfer, donate (attacker action), warp time ...
}

contract VaultInvariants is Test {
    function setUp() public { /* deploy, create handler */ targetContract(address(handler)); }
    function invariant_conservation() public view {
        assertLe(handler.ghostWithdrawn(), handler.ghostDeposited() + handler.ghostYield());
    }
}
```

Include hostile actions in the handler (direct donations, dust deposits, time jumps), not only polite ones.
Restrict targets with `targetSelector` when some functions should not be fuzzed directly.

## Interpreting results

- A falsified invariant gives a call sequence: replay it as a unit test, then decide whether the code or the
  property is wrong. A wrong property is fixed in the test with a comment explaining why.
- A suite that never reverts and never fails may not be exploring: log action counts and check that state
  actually changes (balances grow, time advances).
- For `template: "fuzz"` matters the run count (1,000 to 10,000,000) comes from the matter; report runs, depth,
  seed and the result for each invariant.

## Sources and freshness

Written for Company.md in 2026, describing in the firm's own words the invariant-discovery approach
publicly associated with Pashov Audit Group's fizz skill, together with Foundry's invariant testing
documentation (handlers, ghost variables, target selection). Foundry configuration keys change between
versions; check the installed version.
