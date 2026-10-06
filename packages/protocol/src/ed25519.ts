/**
 * Device keys (Ed25519, node:crypto) and signing envelopes.
 *
 * The device key never touches a wallet. A seat's wallet signs one EIP-712 WorkerAuthorization that binds
 * (tokenId, deviceKey); after that the device signs every WebSocket frame and every device-authenticated
 * HTTP call. Every signature is over the envelope string
 *
 *     comd.v2\n<KIND>\n<PAYLOAD_HASH>
 *
 * where PAYLOAD_HASH = sha256(canonicalJson(payload)) as 64 lowercase hex, and KIND names what is signed
 * (`frame.hello`, `enrollment.revoke`, `fuzz.result`, `bundle.upload`, ...). The kind is part of the signed
 * bytes, so a signature for one purpose can never be replayed as another.
 *
 * Wire forms: deviceKey = 64 lowercase hex (raw 32-byte public key, no 0x); signature = 128 lowercase hex.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from "node:crypto";
import { canonicalJson, sha256Hex } from "./canonical.ts";

export const ENVELOPE_PREFIX = "comd.v2";
export const DEVICE_KEY_RE = /^[0-9a-f]{64}$/;
export const SIGNATURE_RE = /^[0-9a-f]{128}$/;

export interface DeviceKeyPair {
  /** 64 lowercase hex: raw Ed25519 public key */
  deviceKey: string;
  /** PKCS#8 PEM, kept in ~/.company/config.json (mode 0600) */
  privateKeyPem: string;
}

export function generateDeviceKey(): DeviceKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { deviceKey: rawPublicKey(publicKey), privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}

export function deviceKeyFromPrivatePem(pem: string): string {
  return rawPublicKey(createPublicKey(createPrivateKey(pem)));
}

function rawPublicKey(k: KeyObject): string {
  const jwk = k.export({ format: "jwk" }) as { x: string };
  return Buffer.from(jwk.x, "base64url").toString("hex");
}

function publicKeyObject(deviceKey: string): KeyObject {
  if (!DEVICE_KEY_RE.test(deviceKey)) throw new Error("deviceKey must be 64 lowercase hex");
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(deviceKey, "hex").toString("base64url") }, format: "jwk" });
}

/** The exact string that is signed. */
export function envelopeString(kind: string, payload: unknown): string {
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(kind)) throw new Error(`bad envelope kind: ${kind}`);
  return `${ENVELOPE_PREFIX}\n${kind}\n${sha256Hex(canonicalJson(payload))}`;
}

export function signEnvelope(privateKeyPem: string, kind: string, payload: unknown): string {
  return sign(null, Buffer.from(envelopeString(kind, payload), "utf8"), createPrivateKey(privateKeyPem)).toString("hex");
}

export function verifyEnvelope(deviceKey: string, kind: string, payload: unknown, signature: string): boolean {
  try {
    if (typeof signature !== "string" || !SIGNATURE_RE.test(signature)) return false;
    return verify(null, Buffer.from(envelopeString(kind, payload), "utf8"), publicKeyObject(deviceKey), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

/** A device-signed HTTP body: `POST /enrollments/revoke`, `/fuzz/result`, `/bundles`, `/sites/publish`. */
export interface SignedEnvelope<P = Record<string, unknown>> {
  v: 2;
  kind: string;
  deviceKey: string;
  /** must carry `nonce` (64 hex, single use) and `expiresAt` (unix seconds, ≤ 10 min ahead) */
  payload: P & { nonce: string; expiresAt: number };
  signature: string;
}

export const ENVELOPE_MAX_TTL_SECONDS = 600;

export function makeSignedEnvelope<P extends Record<string, unknown>>(
  key: DeviceKeyPair,
  kind: string,
  payload: P,
  opts: { ttlSeconds?: number; now?: number } = {},
): SignedEnvelope<P> {
  const nowS = Math.floor((opts.now ?? Date.now()) / 1000);
  const full = { ...payload, nonce: randomBytes(32).toString("hex"), expiresAt: nowS + (opts.ttlSeconds ?? 300) };
  return { v: 2, kind, deviceKey: key.deviceKey, payload: full, signature: signEnvelope(key.privateKeyPem, kind, full) };
}

export type EnvelopeCheck = { ok: true } | { ok: false; error: "invalid_envelope" | "invalid_signature" | "envelope_expired"; detail: string };

/** Structural + signature + window check. Nonce single-use is the server's job (it keeps the seen set). */
export function checkSignedEnvelope(env: unknown, expectedKind: string, nowMs = Date.now()): EnvelopeCheck {
  const e = env as SignedEnvelope;
  if (!e || typeof e !== "object" || e.v !== 2) return { ok: false, error: "invalid_envelope", detail: "v must be 2" };
  if (e.kind !== expectedKind) return { ok: false, error: "invalid_envelope", detail: `kind must be ${expectedKind}` };
  if (typeof e.deviceKey !== "string" || !DEVICE_KEY_RE.test(e.deviceKey)) return { ok: false, error: "invalid_envelope", detail: "deviceKey must be 64 lowercase hex" };
  if (!e.payload || typeof e.payload !== "object" || Array.isArray(e.payload)) return { ok: false, error: "invalid_envelope", detail: "payload must be an object" };
  if (typeof e.payload.nonce !== "string" || !/^[0-9a-f]{64}$/.test(e.payload.nonce)) return { ok: false, error: "invalid_envelope", detail: "payload.nonce must be 64 hex" };
  if (!Number.isInteger(e.payload.expiresAt)) return { ok: false, error: "invalid_envelope", detail: "payload.expiresAt must be unix seconds" };
  const nowS = Math.floor(nowMs / 1000);
  if (e.payload.expiresAt < nowS) return { ok: false, error: "envelope_expired", detail: "payload.expiresAt is in the past" };
  if (e.payload.expiresAt > nowS + ENVELOPE_MAX_TTL_SECONDS + 60) return { ok: false, error: "invalid_envelope", detail: "payload.expiresAt too far ahead" };
  if (!verifyEnvelope(e.deviceKey, e.kind, e.payload, e.signature)) return { ok: false, error: "invalid_signature", detail: "Ed25519 signature does not verify" };
  return { ok: true };
}

/** Header names for binary device uploads (`POST /artifacts`), where the body is raw bytes. */
export const DEVICE_HEADERS = {
  device: "x-company-device",
  payload: "x-company-payload", // base64(canonicalJson(payload))
  signature: "x-company-signature",
} as const;

export function randomHex(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}
