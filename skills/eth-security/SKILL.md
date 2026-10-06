---
id: eth-security
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
topics: [solidity, security, checklist]
description: A Solidity safety checklist covering decimals, math, access control, external calls, signatures and proxies.
---

# Solidity security checklist

## Purpose

A working checklist for anyone writing or reviewing Solidity in a matter. It is ordered by how often each
class of bug costs money in practice, and every item is phrased so it can be checked against code. It is
not a methodology for a full audit (see `pashov-skill`); it is what every implementer should have walked
through before submitting.

## How to apply

Implementers: walk every section against your diff before you submit, and leave a comment in code where an
item is deliberately not followed. Reviewers: use the item names in finding titles so findings group cleanly
across seats. When a section clearly does not apply (no tokens, no signatures), skip it in one line.

## Units, decimals and amounts

- Never assume 18 decimals. USDC and USDT use 6; WBTC uses 8. Read `decimals()` once at construction or
  pass it in; store amounts in the token's own units and convert only at the edges.
- Normalise before comparing or adding amounts of different tokens. Mixing a 6- and an 18-decimal amount is
  a 10^12 error.
- Prices need two decimals worth of thought: the price feed's decimals and the token's. Write the unit next
  to every variable name or in NatSpec (`priceE18`, `amountUsdc6`).
- ETH amounts are wei. `msg.value` must be accounted for exactly once; a function that is `payable` but
  ignores `msg.value` traps funds.

## Arithmetic and rounding

- Multiply before dividing; `a / b * c` loses precision. Use `mulDiv` (OpenZeppelin `Math.mulDiv` or Solady
  `FixedPointMathLib`) for `a * b / c` with full 512-bit intermediate precision.
- Decide the rounding direction for every division and make it favour the protocol: round shares minted and
  assets paid out down, round shares burned and assets taken in up.
- Solidity 0.8 checks overflow, except inside `unchecked` blocks and in casts. Every `unchecked` block needs
  a comment proving it cannot overflow. Downcasts (`uint128(x)`) silently truncate: use `SafeCast`.
- Zero is an edge case: zero amount, zero supply, zero price, division by a zero total. First depositor and
  last withdrawer paths deserve their own tests.

## Access control

- List every privileged function and who may call it. Each one is guarded (`onlyOwner`, `onlyRole`, explicit
  `msg.sender` check) or documented as intentionally public.
- Initialisers run once: `initializer` modifier, and implementation contracts call `_disableInitializers()`
  in their constructor.
- Two-step ownership transfer (`Ownable2Step`) for anything holding value. Renouncing must be possible only
  when the system still works without an owner.
- `tx.origin` is never an authorisation check. Since EIP-7702, `msg.sender == tx.origin` no longer proves the
  caller has no code either.

## External calls and reentrancy

- Checks, effects, interactions: update state before calling out. Add `nonReentrant` to functions that move
  value and call untrusted code; remember that view functions read during a reentrant call can return stale
  state (read-only reentrancy), which matters to integrators that price off them.
- Callbacks are external calls: ERC-721 `onERC721Received`, ERC-1155 hooks, ERC-777 hooks, Uniswap v4 hook
  callbacks, flash-loan callbacks, and any token with transfer hooks.
- Use `SafeERC20` (`safeTransfer`, `safeTransferFrom`, `forceApprove`): some tokens return nothing, some
  return false instead of reverting, and some (USDT) require allowance reset to zero before a new approval.
- A low-level `call` to an address without code succeeds. Check `address.code.length` when that matters.
- Sending ETH: use `call{value: x}("")`, check the result, and prefer pull payments to pushing ETH in loops.

## Tokens you do not control

- Fee-on-transfer and rebasing tokens break `amount in == amount received`. Measure balance before and after,
  or document that such tokens are unsupported and reject them.
- Issuer-controlled stablecoins (USDC, USDT) can freeze addresses and pause transfers. A contract that must
  pay out may be blocked; design for a failed transfer not to lock everyone else.
- `approve` front-running: prefer `increaseAllowance`-style patterns or Permit2 with exact amounts and
  deadlines.

## Signatures

- `ecrecover` returns `address(0)` on bad input: reject it. Use OpenZeppelin `ECDSA.recover`, which also
  rejects malleable high-`s` signatures.
- Every signed message carries a nonce (or a used-hash bitmap), a deadline, the chain id and the verifying
  contract: use EIP-712 domains. Cache the domain separator but recompute it if `block.chainid` changes.
- Support contract signers with ERC-1271 (`SignatureChecker`) where wallets may be smart accounts.

## Oracles and prices

- Never price off a spot pool balance or `slot0` in the same transaction an attacker can manipulate.
  Use TWAPs, Chainlink-style feeds, or the protocol's own accounting.
- Check feed staleness (`updatedAt`), non-positive answers, and on L2s the sequencer uptime feed when one
  exists.

## Denial of service and gas

- No unbounded loops over user-growable arrays in functions that must succeed (withdraw, liquidate).
- A single failing recipient must not block a batch: isolate failures or switch to pull.
- Griefing via dust: minimum amounts where a zero or tiny action has a cost to others.

## Upgradeability and deployment

- Prefer immutable contracts. If upgradeable: storage layout preserved (use ERC-7201 namespaced storage),
  `_authorizeUpgrade` guarded, implementation initialisers disabled, and an upgrade timelock disclosed.
- `selfdestruct` no longer deletes code (EIP-6780) except in the creating transaction; do not rely on it.
- Constructor arguments and deploy scripts are part of the attack surface: verify final owners and roles in a
  test of the deployment script.

## Sources and freshness

Written for Company.md in 2026 from the Solidity documentation (0.8.x), OpenZeppelin Contracts 5.x
documentation, the EIPs cited by number (EIP-170, 712, 1271, 2612, 6780, 7201, 7702), and public post-mortems
of the bug classes listed. Library function names change between major versions: confirm them against the
version pinned in the project before relying on a name here.
