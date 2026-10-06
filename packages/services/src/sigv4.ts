/**
 * Minimal AWS Signature Version 4 signer for S3-compatible object stores (AWS S3, Cloudflare R2,
 * Railway Buckets, MinIO). Path-style addressing, single-chunk payloads with a signed SHA-256.
 */
import { createHash, createHmac } from "node:crypto";

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SignInput {
  method: string;
  url: URL;
  headers?: Record<string, string>;
  body?: Uint8Array;
  region: string;
  service?: string;
  credentials: SigV4Credentials;
  now?: Date;
}

const hmac = (key: Uint8Array | string, data: string) => createHmac("sha256", key).update(data).digest();
const hex = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/** RFC 3986 encoding as S3 expects (keeps `/` when encoding a path). */
export function uriEncode(str: string, keepSlash: boolean): string {
  let out = "";
  for (const ch of Buffer.from(str, "utf8")) {
    const c = String.fromCharCode(ch);
    if (/[A-Za-z0-9\-._~]/.test(c) || (keepSlash && c === "/")) out += c;
    else out += `%${ch.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** Returns the headers to send (including Authorization, x-amz-date, x-amz-content-sha256). */
export function signRequest(input: SignInput): Record<string, string> {
  const service = input.service ?? "s3";
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = hex(input.body ?? new Uint8Array());
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) headers[k.toLowerCase()] = String(v).trim();
  headers["host"] = input.url.host;
  headers["x-amz-date"] = amzDate;
  headers["x-amz-content-sha256"] = payloadHash;
  if (input.credentials.sessionToken) headers["x-amz-security-token"] = input.credentials.sessionToken;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((k) => `${k}:${headers[k].replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  // pathname is already percent-encoded by URL; decode then re-encode S3-style for a stable canonical form
  const canonicalPath = uriEncode(decodeURIComponent(input.url.pathname), true);
  const query = [...input.url.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k, false), uriEncode(v, false)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [input.method.toUpperCase(), canonicalPath, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${input.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${input.credentials.secretAccessKey}`, date);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  headers["authorization"] =
    `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  delete headers["host"]; // fetch sets Host itself
  return headers;
}

/** Recompute a request's signature server-side (used by the in-process fake S3 in tests). */
export function verifySignature(opts: {
  method: string;
  url: URL;
  headers: Record<string, string | string[] | undefined>;
  body: Uint8Array;
  credentials: SigV4Credentials;
}): boolean {
  const auth = String(opts.headers["authorization"] ?? "");
  const m = /Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})/.exec(auth);
  if (!m) return false;
  const [, keyId, , region, service, signed] = m;
  if (keyId !== opts.credentials.accessKeyId) return false;
  const amzDate = String(opts.headers["x-amz-date"] ?? "");
  const now = new Date(
    `${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`,
  );
  const hdrs: Record<string, string> = {};
  for (const name of signed.split(";")) {
    if (name === "host" || name === "x-amz-date" || name === "x-amz-content-sha256") continue;
    hdrs[name] = String(opts.headers[name] ?? "");
  }
  if (hex(opts.body) !== opts.headers["x-amz-content-sha256"]) return false;
  const again = signRequest({
    method: opts.method,
    url: new URL(opts.url.toString().replace(/^http:\/\/[^/]+/, `http://${opts.headers["host"]}`)),
    headers: hdrs,
    body: opts.body,
    region,
    service,
    credentials: opts.credentials,
    now,
  });
  return again["authorization"] === auth;
}
