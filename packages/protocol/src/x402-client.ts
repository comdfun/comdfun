/**
 * Client side of the paid flow: from a 402 challenge, build and sign the x402 exact/permit2 payment payload and the
 * EIP-712 QuoteApproval. `signer` is any EIP-712 signer (a viem account, or a wallet client wrapper).
 */
import { randomBytes } from "node:crypto";
import { encodeHeaderJson, paymentHash, type PaymentPayload, type PaymentRequired } from "./x402.ts";
import { permit2TypedData, quoteApprovalTypedData, type Permit2Authorization } from "./eip712.ts";

export interface TypedSigner {
  address: `0x${string}`;
  signTypedData(td: any): Promise<`0x${string}`>;
}

export interface SignedPayment {
  payment: PaymentPayload;
  /** value for the PAYMENT-SIGNATURE header */
  header: string;
  /** body of the paid submit: {quoteSignature} */
  quoteSignature: `0x${string}`;
  paymentHash: `0x${string}`;
}

export async function signPayment(ch: PaymentRequired, signer: TypedSigner, o: { nonce?: string; deadline?: number; validAfter?: number; resourceUrl?: string } = {}): Promise<SignedPayment> {
  const req = ch.accepts[0];
  const chainId = Number(req.network.split(":")[1]);
  const auth: Permit2Authorization = {
    from: signer.address,
    permitted: { token: req.asset, amount: req.amount },
    spender: req.extra.spender ?? ch.permit2.spender,
    nonce: o.nonce ?? BigInt(`0x${randomBytes(16).toString("hex")}`).toString(),
    deadline: o.deadline ?? ch.quote.expiresAt + 300,
    witness: { to: req.payTo, validAfter: o.validAfter ?? 0 },
  };
  const signature = await signer.signTypedData(permit2TypedData(auth, chainId, ch.permit2.address));
  const payment: PaymentPayload = { x402Version: 2, resource: { url: o.resourceUrl ?? ch.resourceUrl }, accepted: req, payload: { signature, permit2Authorization: auth } };
  const pHash = paymentHash(payment);
  const quoteSignature = await signer.signTypedData(quoteApprovalTypedData({
    resource: ch.resourceUrl,
    requesterScopeHash: `0x${ch.requesterScopeHash}`,
    quoteId: ch.quote.id,
    quoteHash: `0x${ch.quote.quoteHash}`,
    paymentHash: pHash,
    action: ch.quote.action,
    asset: req.asset,
    amount: req.amount,
    payTo: req.payTo,
    expiresAt: ch.quote.expiresAt,
  }, chainId));
  return { payment, header: encodeHeaderJson(payment), quoteSignature, paymentHash: pHash };
}

/** A fresh 32-byte request token (hex) for Authorization: Bearer. */
export function newRequestToken(): string {
  return randomBytes(32).toString("hex");
}
