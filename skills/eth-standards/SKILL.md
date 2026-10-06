---
id: eth-standards
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
topics: [erc-8004, x402, eip-3009, erc-2612, permit2, eip-7702, erc-4337, eip-712, erc-1271]
description: Working notes on the standards the firm runs on: ERC-8004 identity, x402 payments, permits, EIP-7702 and ERC-4337.
---

# Standards notes

## Purpose

Company.md is built from a handful of standards: seats are ERC-8004 agents, matters are paid with x402 over
Permit2 in $COMD, signatures are EIP-712, and users may hold smart accounts (ERC-4337) or delegated EOAs
(EIP-7702). This reference explains each in enough depth to implement against it correctly and lists the
mistakes that recur.

## How to apply

Consult the relevant section before writing code that signs, verifies, pays or identifies. When the
project vendors a standard's reference contracts (for example ERC-8004 registries under `contracts/lib`),
the vendored source wins over this summary: read its exact function signatures.

## EIP-712 typed data (foundation for everything below)

- A signature covers `keccak256("\x19\x01" || domainSeparator || hashStruct(message))`. The domain binds
  `name`, `version`, `chainId` and `verifyingContract` (and optionally `salt`), which stops replay across
  chains and contracts.
- `hashStruct` hashes the type string exactly as declared, including referenced struct types appended in
  alphabetical order. A single wrong space in the type string breaks every signature.
- Contracts expose their domain via EIP-5267 `eip712Domain()`; wallets and our API read it instead of
  hard-coding. Recompute the separator when `block.chainid` differs from the cached one.
- Our off-chain domains: "Company.md Worker" (WorkerAuthorization), "Company.md Paid Action"
  (QuoteApproval), "Company.md Oracle" (OracleAttestation), all version "1".

## ERC-1271 and ERC-6492 (contract signers)

- A contract wallet proves a signature with `isValidSignature(bytes32 hash, bytes signature)` returning the
  magic value `0x1626ba7e`. Verify with OpenZeppelin `SignatureChecker`, which tries ECDSA and then ERC-1271.
- ERC-6492 wraps signatures from smart accounts that are not deployed yet (counterfactual); verifiers that
  must accept them call a universal validator off chain.

## ERC-2612 permit

- `permit(owner, spender, value, deadline, v, r, s)` sets an allowance by signature;
  `Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)`, sequential `nonces`.
- Front-running grief: anyone can submit a seen permit first, making your `permit` call revert. Wrap it in
  `try/catch` and continue if the allowance is already sufficient.
- Not every token supports it, and some (DAI on mainnet) use a different permit signature. Detect, do not assume.

## Permit2 (Uniswap)

- One contract, `0x000000000022D473030F116dDEE9F6B43aC78BA3` on most EVM chains (deployed with a
  deterministic deployer; verify `eth_getCode` per chain). Users approve Permit2 once per token, then sign
  per-use permits.
- SignatureTransfer: `permitTransferFrom` moves tokens once with an unordered nonce (a bitmap; any unused
  nonce works) and a deadline. `permitWitnessTransferFrom` adds a witness struct the signer also commits to;
  x402's Permit2 scheme uses this so the payment and the paid request are bound together.
- AllowanceTransfer: time-limited allowances set by signature (`permit`) with packed nonces.
- Users see one ERC-20 approval of Permit2. Our UI asks for an allowance large enough for ten paid requests.

## EIP-3009 transfer with authorization

- `transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)` moves tokens by
  signature with a random 32-byte nonce (not sequential, so authorizations can be used out of order).
- `receiveWithAuthorization` additionally requires `msg.sender == to`, preventing a third party from
  front-running the transfer into a different context. Prefer it when a contract is the recipient.
- `cancelAuthorization` burns a nonce. USDC implements EIP-3009; do not assume other tokens do. Our payment
  flow uses Permit2, which works for any ERC-20 (COMD included).

## x402 (HTTP 402 payments)

- A server answers a paid route with `402 Payment Required` and a `PAYMENT-REQUIRED` header (base64 JSON)
  listing acceptable payments: `x402Version`, `scheme` (`exact`), `network` as CAIP-2 (`eip155:4663`),
  `asset` (the COMD token address), `amount` in atomic units (18 decimals), `payTo`, timeouts and `extra` (for us
  `assetTransferMethod: "permit2"` and the EIP-712 domain).
- The client signs and retries with `PAYMENT-SIGNATURE`; the server (or a facilitator) verifies, settles
  on chain paying the gas, and may return `PAYMENT-RESPONSE` with the transaction hash.
- Make every paid request idempotent (`requestKey`), bind the payment to the quote (`quoteHash` in the signed
  approval), and never deliver before settlement is confirmed.

## ERC-8004 trustless agents

- Identity Registry: an ERC-721 where each token is an agent; `register(agentURI)` mints and sets the URI of
  a registration file (JSON: `type`, `name`, `description`, `image`, service endpoints, `x402Support`,
  `supportedTrust`, and `registrations` linking `agentId` to `eip155:<chainId>:<registry>`).
- Reputation Registry: clients post feedback about an agent (a score or value with tags, an optional URI and
  content hash); feedback can be revoked and responded to. The agent's owner or operator cannot rate itself.
- Validation Registry: request and record independent validation of an agent's work.
- In the firm a Counsel NFT is the seat and is bound to an ERC-8004 agent; accepted work becomes batched
  reputation feedback. The registries are not deployed on Robinhood Chain by anyone else, so the firm deploys
  the CC0 reference contracts; use the vendored signatures.

## EIP-7702 (set-code transactions)

- Transaction type 4 carries an authorization list `[chainId, address, nonce, yParity, r, s]`; each
  authorizing EOA gets the code `0xef0100 || address`, delegating execution to `address` until changed.
  Live on Ethereum since the Pectra upgrade (May 2025); support on an L2 depends on its upgrade level.
- Consequences: `tx.origin == msg.sender` no longer implies "no code"; an EOA can batch calls and use
  sponsored gas; storage written under one delegate persists when the delegate changes (layout collisions);
  initialisation of delegated wallets can be front-run; an authorization with `chainId` 0 is valid on every
  chain.

## ERC-4337 account abstraction

- Users send `UserOperation`s to bundlers; the bundler calls `EntryPoint.handleOps`. EntryPoint v0.7 is at
  `0x0000000071727De22E5E9d8BAf0edAc6f37da032`, v0.8 at `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`
  (verify per chain).
- The account's `validateUserOp` must follow the validation rules (ERC-7562): no banned opcodes, restricted
  storage access, so bundlers can simulate safely. Paymasters sponsor gas and must protect their deposit.
- For contracts receiving calls from smart accounts: the caller is the account, signatures need ERC-1271, and
  the first call may come from an undeployed account (ERC-6492).

## Sources and freshness

Written for Company.md in 2026 from the EIP texts (712, 1271, 2612, 3009, 5267, 6492, 7562, 7702, 8004),
ERC-4337 documentation, Uniswap's Permit2 documentation and the x402 specification (v2 headers). ERC-8004 and
x402 were still evolving in 2025–2026: field names in particular must be confirmed against the vendored
contracts and the API's `GET /requests/capabilities` before use.
