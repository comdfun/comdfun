/**
 * x402 v2, scheme `exact`, asset transfer method `permit2` — the shapes of the 402 challenge
 * (`PAYMENT-REQUIRED`) and of the client's `PAYMENT-SIGNATURE` header, with a strict parser.
 *
 * Strict means: unknown keys anywhere are refused, every field is type-checked, and the error names the
 * first offending path (returned to clients as `invalid_payment_shape` with that `detail`).
 */
import { canonicalJson, sha256Hex } from "./canonical.ts";
import type { Permit2Authorization } from "./eip712.ts";

export interface PaymentRequirements {
  scheme: "exact";
  network: string; // eip155:<chainId>
  asset: `0x${string}`;
  amount: string; // atomic units, decimal
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
  /**
   * `assetTransferMethod` is always "permit2". `spender` is the Permit2 spender the payer must name in
   * PermitWitnessTransferFrom (the settlement wallet); `name`/`version` describe the asset's own EIP-712 domain.
   * Clients echo `accepts[0]` back verbatim as `accepted`.
   */
  extra: { assetTransferMethod: "permit2"; spender?: `0x${string}`; name?: string; version?: string };
}

export interface ChallengeQuote {
  id: string;
  quoteHash: string; // 64 hex
  action: string;
  payment: { network: string; asset: `0x${string}`; amount: string; payTo: `0x${string}` };
  expiresAt: number;
}

/** 402 body; the same JSON base64-encoded goes into the `PAYMENT-REQUIRED` header. */
export interface PaymentRequired {
  x402Version: 2;
  error?: string;
  accepts: PaymentRequirements[];
  quote: ChallengeQuote;
  requesterScopeHash: string; // 64 hex
  resourceUrl: string;
  /** Permit2 spender the client must name (the settlement wallet) and the Permit2 contract. */
  permit2: { address: `0x${string}`; spender: `0x${string}`; witnessTypeString: string };
}

export interface PaymentPayload {
  x402Version: 2;
  resource?: { url?: string; description?: string; mimeType?: string };
  accepted: PaymentRequirements;
  payload: {
    signature: `0x${string}`;
    permit2Authorization: Permit2Authorization;
  };
  extensions?: Record<string, unknown>;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; detail: string };

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^(0|[1-9][0-9]{0,77})$/;
const SIG65 = /^0x[0-9a-fA-F]{130}$/;

class ShapeError extends Error {}

function obj(v: unknown, path: string, allowed: string[], required: string[]): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ShapeError(`${path} must be an object`);
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new ShapeError(`${path}.${k} is not allowed`);
  for (const k of required) if (o[k] === undefined) throw new ShapeError(`${path}.${k} is required`);
  return o;
}
function str(v: unknown, path: string, max = 2048): string {
  if (typeof v !== "string" || v.length > max) throw new ShapeError(`${path} must be a string`);
  return v;
}
function addr(v: unknown, path: string): `0x${string}` {
  if (typeof v !== "string" || !ADDR.test(v)) throw new ShapeError(`${path} must be a 20-byte hex address`);
  return v as `0x${string}`;
}
function uintStr(v: unknown, path: string): string {
  if (typeof v !== "string" || !UINT.test(v)) throw new ShapeError(`${path} must be a decimal integer string`);
  return v;
}
function int(v: unknown, path: string): number {
  if (typeof v === "string" && /^[0-9]{1,15}$/.test(v)) return Number(v);
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new ShapeError(`${path} must be a non-negative integer`);
  return v;
}

export function parseRequirements(v: unknown, path = "accepted"): PaymentRequirements {
  const o = obj(v, path, ["scheme", "network", "asset", "amount", "payTo", "maxTimeoutSeconds", "extra"], ["scheme", "network", "asset", "amount", "payTo", "maxTimeoutSeconds", "extra"]);
  if (o.scheme !== "exact") throw new ShapeError(`${path}.scheme must be "exact"`);
  const network = str(o.network, `${path}.network`, 64);
  if (!/^eip155:[1-9][0-9]{0,15}$/.test(network)) throw new ShapeError(`${path}.network must be eip155:<chainId>`);
  const extra = obj(o.extra, `${path}.extra`, ["assetTransferMethod", "spender", "name", "version"], ["assetTransferMethod"]);
  if (extra.assetTransferMethod !== "permit2") throw new ShapeError(`${path}.extra.assetTransferMethod must be "permit2"`);
  const ex: PaymentRequirements["extra"] = { assetTransferMethod: "permit2" };
  if (extra.spender !== undefined) ex.spender = addr(extra.spender, `${path}.extra.spender`);
  if (extra.name !== undefined) ex.name = str(extra.name, `${path}.extra.name`, 128);
  if (extra.version !== undefined) ex.version = str(extra.version, `${path}.extra.version`, 32);
  return {
    scheme: "exact",
    network,
    asset: addr(o.asset, `${path}.asset`),
    amount: uintStr(o.amount, `${path}.amount`),
    payTo: addr(o.payTo, `${path}.payTo`),
    maxTimeoutSeconds: int(o.maxTimeoutSeconds, `${path}.maxTimeoutSeconds`),
    extra: ex,
  };
}

export function parsePaymentPayload(v: unknown): ParseResult<PaymentPayload> {
  try {
    const o = obj(v, "payment", ["x402Version", "resource", "accepted", "payload", "extensions"], ["x402Version", "accepted", "payload"]);
    if (o.x402Version !== 2) throw new ShapeError("payment.x402Version must be 2");
    let resource: PaymentPayload["resource"];
    if (o.resource !== undefined) {
      const r = obj(o.resource, "payment.resource", ["url", "description", "mimeType"], []);
      resource = {};
      if (r.url !== undefined) resource.url = str(r.url, "payment.resource.url");
      if (r.description !== undefined) resource.description = str(r.description, "payment.resource.description");
      if (r.mimeType !== undefined) resource.mimeType = str(r.mimeType, "payment.resource.mimeType", 128);
    }
    const accepted = parseRequirements(o.accepted, "payment.accepted");
    const p = obj(o.payload, "payment.payload", ["signature", "permit2Authorization"], ["signature", "permit2Authorization"]);
    if (typeof p.signature !== "string" || !SIG65.test(p.signature)) throw new ShapeError("payment.payload.signature must be a 65-byte hex signature");
    const a = obj(p.permit2Authorization, "payment.payload.permit2Authorization", ["from", "permitted", "spender", "nonce", "deadline", "witness"], ["from", "permitted", "spender", "nonce", "deadline", "witness"]);
    const permitted = obj(a.permitted, "payment.payload.permit2Authorization.permitted", ["token", "amount"], ["token", "amount"]);
    const witness = obj(a.witness, "payment.payload.permit2Authorization.witness", ["to", "validAfter"], ["to", "validAfter"]);
    let extensions: Record<string, unknown> | undefined;
    if (o.extensions !== undefined) extensions = obj(o.extensions, "payment.extensions", Object.keys(o.extensions as object), []);
    return {
      ok: true,
      value: {
        x402Version: 2,
        ...(resource ? { resource } : {}),
        accepted,
        payload: {
          signature: p.signature as `0x${string}`,
          permit2Authorization: {
            from: addr(a.from, "payment.payload.permit2Authorization.from"),
            permitted: {
              token: addr(permitted.token, "payment.payload.permit2Authorization.permitted.token"),
              amount: uintStr(permitted.amount, "payment.payload.permit2Authorization.permitted.amount"),
            },
            spender: addr(a.spender, "payment.payload.permit2Authorization.spender"),
            nonce: uintStr(a.nonce, "payment.payload.permit2Authorization.nonce"),
            deadline: int(a.deadline, "payment.payload.permit2Authorization.deadline"),
            witness: {
              to: addr(witness.to, "payment.payload.permit2Authorization.witness.to"),
              validAfter: int(witness.validAfter, "payment.payload.permit2Authorization.witness.validAfter"),
            },
          },
        },
        ...(extensions ? { extensions } : {}),
      },
    };
  } catch (e) {
    if (e instanceof ShapeError) return { ok: false, detail: e.message };
    throw e;
  }
}

/** Decode the `PAYMENT-SIGNATURE` header (base64 or base64url of JSON) and parse strictly. */
export function parsePaymentSignatureHeader(header: string | undefined | null): ParseResult<{ payment: PaymentPayload; raw: unknown }> {
  if (!header || typeof header !== "string") return { ok: false, detail: "PAYMENT-SIGNATURE header is missing" };
  if (header.length > 12_000) return { ok: false, detail: "PAYMENT-SIGNATURE header is too large" };
  let raw: unknown;
  try {
    const text = Buffer.from(header.trim(), header.includes("-") || header.includes("_") ? "base64url" : "base64").toString("utf8");
    raw = JSON.parse(text);
  } catch {
    return { ok: false, detail: "PAYMENT-SIGNATURE must be base64-encoded JSON" };
  }
  const r = parsePaymentPayload(raw);
  return r.ok ? { ok: true, value: { payment: r.value, raw } } : r;
}

/** `paymentHash` of a QuoteApproval: 0x + sha256 of the canonical JSON of the decoded payment object. */
export function paymentHash(raw: unknown): `0x${string}` {
  return `0x${sha256Hex(canonicalJson(raw))}`;
}

export function encodeHeaderJson(v: unknown): string {
  return Buffer.from(JSON.stringify(v), "utf8").toString("base64");
}

export function decodeHeaderJson<T = unknown>(h: string): T {
  return JSON.parse(Buffer.from(h, "base64").toString("utf8")) as T;
}

export function networkOf(chainId: number): string {
  return `eip155:${chainId}`;
}

/** Same terms? (case-insensitive addresses; everything else exact). */
export function sameRequirements(a: PaymentRequirements, b: PaymentRequirements): string | null {
  if (a.scheme !== b.scheme) return "scheme";
  if (a.network !== b.network) return "network";
  if (a.asset.toLowerCase() !== b.asset.toLowerCase()) return "asset";
  if (a.amount !== b.amount) return "amount";
  if (a.payTo.toLowerCase() !== b.payTo.toLowerCase()) return "payTo";
  if (a.extra.assetTransferMethod !== b.extra.assetTransferMethod) return "extra.assetTransferMethod";
  if (a.extra.spender && b.extra.spender && a.extra.spender.toLowerCase() !== b.extra.spender.toLowerCase()) return "extra.spender";
  return null;
}
