---
id: eth-frontend-ux
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
topics: [dapp, ux, wallets, viem, wagmi]
description: dApp UX rules for pending states, the connect-switch-approve-execute flow, amounts and address display.
---

# dApp frontend UX

## Purpose

Rules for wallet-connected frontends built by the firm (`frontend-for-contract`, `build-website` when a wallet
is involved) and for reviewing them in `site-content-check`. Users lose money to unclear signing prompts and
double submissions more often than to contract bugs. These rules keep every transaction legible.

## How to apply

Implement each flow in the order given and give every state in the tables a visible representation. Reviewers
check the flows against the tables and the "never" list.

## The write flow

| Stage | What the user sees | Notes |
|---|---|---|
| Disconnected | read-only data and a Connect button | reads must work without a wallet |
| Wrong network | a banner with "Switch to Robinhood Chain" | `wallet_switchEthereumChain`, then `wallet_addEthereumChain` if unknown |
| Needs approval | "Approve 1,000 COMD" with the exact amount | exact approvals by default; unlimited only as an explicit opt-in |
| Ready | the action button with the amount and the expected result | simulate first (`simulateContract`) and show a decoded revert before asking to sign |
| Awaiting signature | "Confirm in your wallet" | disable the button: no double submit |
| Pending | the tx hash linked to the explorer, a spinner | keep the state across page reloads when possible |
| Confirmed | success with what changed | refetch affected reads; do not rely on optimistic numbers |
| Failed / rejected | the decoded reason in plain words | user rejection is not an error; say "Cancelled" |

## Amounts

- Use the token's `decimals()`; stablecoins such as USDC have 6, COMD and ETH 18. Parse input with `parseUnits(input, decimals)` and format
  with `formatUnits`; never use floating point for amounts.
- Show balances with sensible precision (for example 4 significant decimals) but submit exact values. A "Max"
  button uses the exact balance, minus a gas reserve for native ETH.
- Show slippage and deadline for swaps; default slippage small and editable.

## Addresses and names

- Display `0x1234…abcd` (first 6 and last 4) with a copy button and an explorer link. Show the full address on
  hover or in a details view. Compare addresses case-insensitively.
- Name resolution is a hint, never the source of truth: show the address next to any name.

## Signing prompts

- Before any signature, say in the page what is being signed and why. For EIP-712 messages, the page text
  should match the fields the wallet shows (spender, amount, deadline).
- Never request `eth_sign` (blind hash signing). Use `personal_sign` for text and `eth_signTypedData_v4` for
  structured data.
- Permit2 and ERC-2612 permits: show the spender's name and address, the amount and the expiry.

## Network configuration

- Define custom chains with viem `defineChain`: Robinhood Chain id 4663 (testnet 46630), native currency ETH
  with 18 decimals, public RPC URLs, Blockscout explorer. See `eth-robinhood-chain`.
- Public RPCs are rate limited; batch reads with multicall (`multicall3` at
  `0xcA11bde05977b3631167028862bE2a173976CA11` where deployed, verify on chain) and cache.
- Never ship an RPC API key in a static bundle.

## Errors

- Decode custom errors with the ABI and map them to sentences ("Amount exceeds your balance").
- Distinguish: user rejected (code 4001), insufficient funds for gas, simulation revert, RPC failure. Each has
  different advice.

## Never

- Never auto-submit transactions on page load or on connect.
- Never request approvals for tokens the action does not use.
- Never hide the destination address of a transfer.
- Never claim affiliation with a brand; on pages naming Robinhood Chain, include "Not affiliated with Robinhood."

## Sources and freshness

Written for Company.md in 2026 from the viem and wagmi documentation, EIP-1193 (provider errors), EIP-3085 and
EIP-3326 (add/switch chain), wallet signing guidance, and the firm's site-content policy. Library APIs (wagmi
hooks in particular) change across major versions; check the version pinned in the project.
