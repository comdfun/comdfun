"use client";
// Paid request client: quote → 402 challenge → Permit2 witness signature (x402 v2 "exact", assetTransferMethod
// permit2) + EIP-712 QuoteApproval → submit → poll. All calls go through the same-origin /api/requests/* pass-through.
import { sha256, toBytes, type Address, type Hex, type WalletClient } from "viem";
import type { CheckResult, PaymentChallenge, QuoteResponse, RequestStatus, Capabilities } from "./types";
import { addressOf } from "./contracts";

const BASE = "/api/requests";
const TOKEN_KEY = "company.requestToken";

export class PaidError extends Error {
  constructor(public status: number, public code: string, public detail?: unknown) {
    super(typeof detail === "string" ? `${code}: ${detail}` : code);
  }
}

/** 32 random bytes, hex, kept per browser so GET /requests/:id works after a reload. */
export function requestToken(): string {
  try {
    const have = localStorage.getItem(TOKEN_KEY);
    if (have && /^[0-9a-f]{64}$/.test(have)) return have;
  } catch {}
  const b = crypto.getRandomValues(new Uint8Array(32));
  const t = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {}
  return t;
}

async function call<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<{ status: number; body: T; headers: Headers }> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (init.auth) headers.set("authorization", `Bearer ${requestToken()}`);
  const r = await fetch(`${BASE}${path}`, { ...init, headers, cache: "no-store" });
  let body: unknown = null;
  try {
    body = await r.json();
  } catch {}
  return { status: r.status, body: body as T, headers: r.headers };
}

function fail(status: number, body: unknown): never {
  const b = (body ?? {}) as { error?: string; detail?: unknown; problems?: unknown };
  throw new PaidError(status, b.error ?? `http_${status}`, b.detail ?? b.problems);
}

export async function capabilities(): Promise<Capabilities | null> {
  const r = await call<Capabilities>("/capabilities");
  return r.status === 200 ? r.body : null;
}

export async function check(action: string, input: unknown): Promise<CheckResult> {
  const r = await call<unknown>("/check", { method: "POST", body: JSON.stringify({ action, input }) });
  if (r.status !== 200) fail(r.status, r.body);
  return normalizeCheck(r.body);
}

/**
 * POST /requests/check as Chambers answers it (IMD shape): `plan` is a list of lines ("key: skill after x — why"),
 * `suggestions` plain strings, `terms` an object, `judged` a boolean. The page renders the structured form.
 */
export function normalizeCheck(raw: unknown): CheckResult {
  const b = (raw ?? {}) as Record<string, unknown>;
  const msg = (x: unknown) => (typeof x === "string" ? { message: x } : (x as { code?: string; message: string }));
  const arr = (x: unknown) => (Array.isArray(x) ? x : []);
  let plan: CheckResult["plan"];
  if (Array.isArray(b.plan)) {
    const steps = b.plan.map((line) => {
      if (typeof line !== "string") return line as { skill: string };
      const m = /^([^:]+):\s*(\S+)(?:\s+after\s+([^—]+?))?(?:\s+—\s+(.*))?$/.exec(line);
      return m ? { key: m[1].trim(), skill: m[2], dependsOn: m[3] ? m[3].split(",").map((s) => s.trim()) : undefined, why: m[4] } : { skill: line };
    });
    plan = steps.length ? { steps, shape: (b.facts as { shape?: string } | undefined)?.shape } : undefined;
  } else if (b.plan && typeof b.plan === "object") plan = b.plan as CheckResult["plan"];
  const terms = Array.isArray(b.terms) ? (b.terms as string[]) : b.terms && typeof b.terms === "object" ? Object.entries(b.terms as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`) : undefined;
  return {
    ...(b as object),
    action: String(b.action ?? ""),
    blockers: arr(b.blockers).map(msg) as CheckResult["blockers"],
    suggestions: arr(b.suggestions).map(msg),
    plan,
    terms,
    judged: b.judged && typeof b.judged === "object" ? (b.judged as { summary: string }) : undefined,
    project: b.project as CheckResult["project"],
  } as CheckResult;
}

export async function quote(action: string, input: unknown, requestKey = crypto.randomUUID()): Promise<QuoteResponse> {
  const r = await call<QuoteResponse>("/quote", { method: "POST", auth: true, body: JSON.stringify({ requestKey, action, input }) });
  if (r.status !== 200 && r.status !== 201) fail(r.status, r.body);
  return r.body;
}

function decodeChallenge(h: string | null, body: unknown): PaymentChallenge {
  if (h) {
    try {
      return JSON.parse(atob(h)) as PaymentChallenge;
    } catch {}
  }
  if (body && typeof body === "object" && "accepts" in body) return body as PaymentChallenge;
  throw new PaidError(402, "invalid_challenge", "PAYMENT-REQUIRED header missing or unreadable");
}

export async function challenge(orderId: string): Promise<PaymentChallenge> {
  const r = await call<unknown>(`/${orderId}/submit`, { method: "POST", auth: true });
  if (r.status !== 402) fail(r.status, r.body);
  return decodeChallenge(r.headers.get("payment-required"), r.body);
}

/** Canonical JSON: keys sorted at every depth, no whitespace. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const randomUint256 = () => BigInt(`0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) => x.toString(16).padStart(2, "0")).join("")}`);

export interface Signed {
  header: string;
  quoteSignature: Hex;
  payment: unknown;
}

/** Wallet signs the Permit2 transfer (witness {to, validAfter}) and the QuoteApproval for this exact payment. */
export async function sign(wallet: WalletClient, from: Address, ch: PaymentChallenge): Promise<Signed> {
  const req = ch.accepts[0];
  if (!req) throw new PaidError(402, "invalid_challenge", "no accepts[0]");
  const chainId = Number(req.network.split(":")[1]);
  const permit2 = addressOf("Permit2", chainId) ?? "0x000000000022D473030F116dDEE9F6B43aC78BA3";
  const spender = (req.extra.spender ?? req.extra.relay ?? req.extra.proxy ?? req.extra.facilitator) as Address | undefined;
  if (!spender) throw new PaidError(402, "invalid_challenge", "challenge names no Permit2 spender (extra.spender)");
  const now = Math.floor(Date.now() / 1000);
  const deadline = Math.min(ch.quote.expiresAt - 10, now + (req.maxTimeoutSeconds || 600));
  const validAfter = now - 60;
  const nonce = randomUint256();
  const signature = await wallet.signTypedData({
    account: from,
    domain: { name: "Permit2", chainId, verifyingContract: permit2 },
    primaryType: "PermitWitnessTransferFrom",
    types: {
      PermitWitnessTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "witness", type: "Witness" },
      ],
      TokenPermissions: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      Witness: [
        { name: "to", type: "address" },
        { name: "validAfter", type: "uint256" },
      ],
    },
    message: {
      permitted: { token: req.asset as Address, amount: BigInt(req.amount) },
      spender,
      nonce,
      deadline: BigInt(deadline),
      witness: { to: req.payTo as Address, validAfter: BigInt(validAfter) },
    },
  });
  const payment = {
    x402Version: 2,
    resource: ch.resource ?? { url: ch.resourceUrl, description: `Company.md ${ch.quote.action}`, mimeType: "application/json" },
    accepted: req,
    payload: {
      signature,
      permit2Authorization: {
        from: from.toLowerCase(),
        permitted: { token: req.asset, amount: req.amount },
        spender,
        nonce: nonce.toString(),
        deadline: String(deadline),
        witness: { to: req.payTo, validAfter: String(validAfter) },
      },
    },
    extensions: {},
  };
  const json = canonical(payment);
  const header = b64(json);
  const paymentHash = sha256(toBytes(json));
  const q = ch.quote;
  const pay = q.payment ?? { asset: req.asset, amount: req.amount, payTo: req.payTo, network: req.network };
  const quoteSignature = await wallet.signTypedData({
    account: from,
    domain: { name: "Company.md Paid Action", version: "1", chainId },
    primaryType: "QuoteApproval",
    types: {
      QuoteApproval: [
        { name: "resource", type: "string" },
        { name: "requesterScopeHash", type: "bytes32" },
        { name: "quoteId", type: "string" },
        { name: "quoteHash", type: "bytes32" },
        { name: "paymentHash", type: "bytes32" },
        { name: "action", type: "string" },
        { name: "asset", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "payTo", type: "address" },
        { name: "expiresAt", type: "uint256" },
      ],
    },
    message: {
      resource: ch.resourceUrl,
      requesterScopeHash: (ch.requesterScopeHash.startsWith("0x") ? ch.requesterScopeHash : `0x${ch.requesterScopeHash}`) as Hex,
      quoteId: q.id,
      quoteHash: (q.quoteHash.startsWith("0x") ? q.quoteHash : `0x${q.quoteHash}`) as Hex,
      paymentHash,
      action: q.action,
      asset: pay.asset as Address,
      amount: BigInt(pay.amount),
      payTo: pay.payTo as Address,
      expiresAt: BigInt(q.expiresAt),
    },
  });
  return { header, quoteSignature, payment };
}

export async function submit(orderId: string, s: Signed): Promise<RequestStatus> {
  const r = await call<RequestStatus>(`/${orderId}/submit`, { method: "POST", auth: true, headers: { "PAYMENT-SIGNATURE": s.header }, body: JSON.stringify({ quoteSignature: s.quoteSignature }) });
  if (r.status !== 200 && r.status !== 202) fail(r.status, r.body);
  return r.body;
}

export async function status(orderId: string): Promise<RequestStatus> {
  const r = await call<RequestStatus>(`/${orderId}`, { auth: true });
  if (r.status !== 200) fail(r.status, r.body);
  return r.body;
}

export async function poll(orderId: string, onTick: (s: RequestStatus) => void, timeoutMs = 10 * 60_000): Promise<RequestStatus> {
  const end = Date.now() + timeoutMs;
  let wait = 1500;
  for (;;) {
    const s = await status(orderId);
    onTick(s);
    if (["admitted", "payment_failed", "expired"].includes(s.status)) return s;
    if (Date.now() > end) return s;
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(6000, wait * 1.4);
  }
}

/** Where the docket shows what the admission created. */
export function resultHref(s: RequestStatus): string | null {
  const r = s.admission?.result;
  if (!r) return null;
  switch (r.kind) {
    case "job":
      return `/jobs/${r.jobId}`;
    case "workflow":
      return `/jobs/${r.jobId}`;
    case "oracle":
      return `/oracle/${r.requestId}`;
    case "schedule":
      return `/heartbeats/${r.scheduleId}`;
    default:
      return null;
  }
}
