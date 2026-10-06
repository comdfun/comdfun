/**
 * Settlement of x402 exact/permit2 payments in $COMD. The server is the Permit2 spender and pays gas: it calls
 * Permit2.permitWitnessTransferFrom(permit, {to: payTo, requestedAmount}, from, witnessHash, witnessTypeString, sig).
 *
 *   ChainSettler  SETTLER_PRIVATE_KEY + RPC_URL: pre-checks balance and Permit2 allowance, sends, waits for receipt
 *   MockSettler   no key: in-memory balances (tests/demo set them), unique nonces, fake tx hashes
 */
import { formatEther, getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { permit2TypedData, recoverTypedSigner, type PaymentPayload } from "@company/protocol";
import type { ChainReader, ChainWriter } from "./chain.ts";

export type SettleOutcome = { ok: true; txHash: Hex; blockNumber: number } | { ok: false; reason: string };

export interface Settler {
  readonly mode: "mock" | "chain";
  readonly spender: Address;
  settle(p: PaymentPayload, amount: bigint, payTo: Address): Promise<SettleOutcome>;
  gasWallet(): Promise<{ address: Address; balanceEth: string; low: boolean }>;
}

/** Permit2 signature must recover to `from` over PermitWitnessTransferFrom{permitted, spender, nonce, deadline, witness}. */
export async function permit2SignerOk(p: PaymentPayload, chainId: number, permit2: Address): Promise<boolean> {
  const td = permit2TypedData(p.payload.permit2Authorization, chainId, permit2);
  const signer = await recoverTypedSigner(td, p.payload.signature);
  return !!signer && signer.toLowerCase() === p.payload.permit2Authorization.from.toLowerCase();
}

export class MockSettler implements Settler {
  readonly mode = "mock" as const;
  readonly spender: Address;
  balances = new Map<string, bigint>();
  defaultBalance = 10n ** 30n;
  usedNonces = new Set<string>();
  settled: { from: Address; amount: bigint; payTo: Address; txHash: Hex }[] = [];
  constructor(spender: Address) { this.spender = getAddress(spender); }

  async settle(p: PaymentPayload, amount: bigint, payTo: Address): Promise<SettleOutcome> {
    const a = p.payload.permit2Authorization;
    const from = a.from.toLowerCase();
    const nonceKey = `${from}:${a.nonce}`;
    if (this.usedNonces.has(nonceKey)) return { ok: false, reason: "nonce_already_used" };
    const bal = this.balances.get(from) ?? this.defaultBalance;
    if (bal < amount) return { ok: false, reason: "insufficient_funds" };
    this.balances.set(from, bal - amount);
    this.usedNonces.add(nonceKey);
    const txHash = keccak256(toHex(`settle:${nonceKey}:${amount}`));
    this.settled.push({ from: getAddress(a.from), amount, payTo, txHash });
    return { ok: true, txHash, blockNumber: 1 };
  }
  async gasWallet() { return { address: this.spender, balanceEth: "0", low: false }; }
}

export class ChainSettler implements Settler {
  readonly mode = "chain" as const;
  readonly spender: Address;
  private readonly reader: ChainReader;
  private readonly writer: ChainWriter;
  private readonly permit2: Address;
  constructor(reader: ChainReader, writer: ChainWriter, permit2: Address) {
    this.reader = reader;
    this.writer = writer;
    this.permit2 = permit2;
    this.spender = writer.address;
  }

  async settle(p: PaymentPayload, amount: bigint, payTo: Address): Promise<SettleOutcome> {
    const a = p.payload.permit2Authorization;
    try {
      const [bal, allowance] = await Promise.all([
        this.reader.erc20Balance(a.permitted.token, a.from),
        this.reader.erc20Allowance(a.permitted.token, a.from, this.permit2),
      ]);
      if (bal < amount) return { ok: false, reason: "insufficient_funds" };
      if (allowance < amount) return { ok: false, reason: "insufficient_permit2_allowance" };
    } catch (e) {
      return { ok: false, reason: `chain_unavailable: ${(e as Error).message.slice(0, 120)}` };
    }
    try {
      const r = await this.writer.permit2Settle({ auth: a, signature: p.payload.signature, payTo, amount });
      if (r.status !== "success") return { ok: false, reason: "transaction_reverted" };
      return { ok: true, txHash: r.txHash, blockNumber: r.blockNumber };
    } catch (e) {
      const m = (e as Error).message;
      if (/InvalidNonce/i.test(m)) return { ok: false, reason: "nonce_already_used" };
      if (/SignatureExpired/i.test(m)) return { ok: false, reason: "payment_permission_expired" };
      if (/InvalidSigner|InvalidSignature/i.test(m)) return { ok: false, reason: "invalid_signature" };
      return { ok: false, reason: `transaction_failed: ${m.slice(0, 160)}` };
    }
  }

  async gasWallet() {
    try {
      const wei = await this.reader.ethBalance(this.spender);
      return { address: this.spender, balanceEth: formatEther(wei), low: wei < 5n * 10n ** 15n };
    } catch {
      return { address: this.spender, balanceEth: "unknown", low: true };
    }
  }
}
