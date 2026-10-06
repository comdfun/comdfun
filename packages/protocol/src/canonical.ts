/**
 * Canonical JSON: the one byte representation every hash, signature and idempotency key is computed over.
 *
 *  - object keys sorted by UTF-16 code units (JS default sort), `undefined` members dropped
 *  - no whitespace; strings escaped as JSON.stringify does
 *  - numbers must be finite safe integers or finite floats; bigint is refused (send decimal strings)
 *  - `undefined` inside arrays is an error
 */
import { createHash } from "node:crypto";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function canonicalJson(value: unknown): string {
  return enc(value, "$");
}

function enc(v: unknown, path: string): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new Error(`canonicalJson: non-finite number at ${path}`);
      return JSON.stringify(v);
    case "string":
      return JSON.stringify(v);
    case "bigint":
      throw new Error(`canonicalJson: bigint at ${path} (encode as a decimal string)`);
    case "object": {
      if (Array.isArray(v)) {
        return "[" + v.map((x, i) => {
          if (x === undefined) throw new Error(`canonicalJson: undefined in array at ${path}[${i}]`);
          return enc(x, `${path}[${i}]`);
        }).join(",") + "]";
      }
      if (v instanceof Uint8Array) throw new Error(`canonicalJson: bytes at ${path} (encode as hex)`);
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + enc(o[k], `${path}.${k}`)).join(",") + "}";
    }
    default:
      throw new Error(`canonicalJson: unsupported ${typeof v} at ${path}`);
  }
}

/** sha256 hex (64 lowercase chars, no 0x). */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** sha256 over canonical JSON, 64 hex without 0x (the form IMD-style APIs expose as `hash`). */
export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** Same hash, 0x-prefixed so it fits an EIP-712 bytes32. */
export function canonicalHash0x(value: unknown): `0x${string}` {
  return `0x${canonicalHash(value)}`;
}

export const HASH_RE = /^[0-9a-f]{64}$/;
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isHash(s: unknown): s is string {
  return typeof s === "string" && HASH_RE.test(s);
}
export function strip0x(s: string): string {
  return s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s;
}
export function with0x(s: string): `0x${string}` {
  return (s.startsWith("0x") ? s : `0x${s}`) as `0x${string}`;
}
