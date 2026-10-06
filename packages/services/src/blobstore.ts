/**
 * Content-addressed blob store with two drivers:
 *  - local: a directory (STORAGE_DIR), e.g. a Railway volume mounted at /data
 *  - s3:    any S3-compatible bucket (Railway Bucket, Cloudflare R2, AWS S3, MinIO) over SigV4 + fetch
 *
 * Content-addressed blobs live at `blobs/<hh>/<sha256>`. Named objects (site files, manifests,
 * pointers) live at caller-chosen keys via putObject/getObject.
 */
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { signRequest, type SigV4Credentials } from "./sigv4.ts";
import { assertHash, sha256Hex } from "./util.ts";

export interface PutOptions {
  mediaType?: string;
  cacheControl?: string;
}

export interface PutResult {
  key: string;
  hash: string;
  bytes: number;
  mediaType: string;
  url: string;
  /** false when the blob already existed (put is idempotent) */
  created: boolean;
}

export interface StoredObject {
  key: string;
  data: Buffer;
  mediaType: string;
  hash: string;
}

export interface BlobStore {
  readonly driver: "local" | "s3";
  /** Store bytes under their sha256. Idempotent. */
  put(data: Uint8Array | string, opts?: PutOptions): Promise<PutResult>;
  /** Fetch by sha256; verifies the content hash. null when absent. */
  get(hash: string): Promise<StoredObject | null>;
  has(hash: string): Promise<boolean>;
  /** Public URL for a content-addressed blob. */
  url(hash: string): string;
  /** Store bytes at an explicit key (e.g. `sites/<label>/<version>/index.html`). Overwrites. */
  putObject(key: string, data: Uint8Array | string, opts?: PutOptions): Promise<PutResult>;
  getObject(key: string): Promise<StoredObject | null>;
  hasObject(key: string): Promise<boolean>;
  objectUrl(key: string): string;
}

export type StorageEnv = Record<string, string | undefined>;

export function blobKey(hash: string): string {
  assertHash(hash);
  return `blobs/${hash.slice(0, 2)}/${hash}`;
}

function checkKey(key: string): string {
  if (!key || key.startsWith("/") || key.includes("\\") || key.split("/").some((s) => s === ".." || s === "." || s === "")) {
    throw new Error(`invalid object key: ${key}`);
  }
  if (key.startsWith(".meta/")) throw new Error(`reserved key prefix: ${key}`);
  return key;
}

const toBuf = (d: Uint8Array | string) => (typeof d === "string" ? Buffer.from(d, "utf8") : Buffer.from(d.buffer, d.byteOffset, d.byteLength));

/**
 * Create a store from env:
 *   STORAGE_DRIVER=local|s3 (default: s3 when S3_BUCKET is set, else local)
 *   STORAGE_DIR (local; default ./storage)
 *   S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION (default us-east-1),
 *   S3_PUBLIC_URL (public base for objects), S3_VIRTUAL_HOSTED=true for bucket.endpoint style
 *   BLOB_PUBLIC_URL: overrides url(hash) to `${BLOB_PUBLIC_URL}/${hash}` (e.g. https://api.x/artifacts)
 *   PUBLIC_API_URL: local driver fallback base, url(hash) = `${PUBLIC_API_URL}/blobs/${hash}`
 */
export function createBlobStore(env: StorageEnv = process.env): BlobStore {
  const driver = (env.STORAGE_DRIVER || (env.S3_BUCKET ? "s3" : "local")).toLowerCase();
  if (driver === "local") return new LocalBlobStore(env);
  if (driver === "s3") return new S3BlobStore(env);
  throw new Error(`unknown STORAGE_DRIVER: ${driver}`);
}

class LocalBlobStore implements BlobStore {
  readonly driver = "local" as const;
  readonly dir: string;
  private readonly env: StorageEnv;
  constructor(env: StorageEnv) {
    this.env = env;
    this.dir = path.resolve(env.STORAGE_DIR || "./storage");
  }
  private abs(key: string) {
    return path.join(this.dir, ...checkKey(key).split("/"));
  }
  private metaPath(key: string) {
    return path.join(this.dir, ".meta", ...checkKey(key).split("/")) + ".json";
  }
  private async atomicWrite(file: string, data: Uint8Array | string) {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, file);
  }
  url(hash: string): string {
    assertHash(hash);
    if (this.env.BLOB_PUBLIC_URL) return `${this.env.BLOB_PUBLIC_URL.replace(/\/$/, "")}/${hash}`;
    if (this.env.PUBLIC_API_URL) return `${this.env.PUBLIC_API_URL.replace(/\/$/, "")}/blobs/${hash}`;
    return `file://${this.abs(blobKey(hash))}`;
  }
  objectUrl(key: string): string {
    if (this.env.PUBLIC_API_URL) return `${this.env.PUBLIC_API_URL.replace(/\/$/, "")}/storage/${checkKey(key)}`;
    return `file://${this.abs(key)}`;
  }
  async put(data: Uint8Array | string, opts: PutOptions = {}): Promise<PutResult> {
    const buf = toBuf(data);
    const hash = sha256Hex(buf);
    const key = blobKey(hash);
    const mediaType = opts.mediaType ?? "application/octet-stream";
    const exists = await this.hasObject(key);
    if (!exists) await this.writeObject(key, buf, mediaType, hash);
    return { key, hash, bytes: buf.length, mediaType, url: this.url(hash), created: !exists };
  }
  private async writeObject(key: string, buf: Buffer, mediaType: string, hash: string) {
    await this.atomicWrite(this.abs(key), buf);
    await this.atomicWrite(this.metaPath(key), JSON.stringify({ mediaType, hash, bytes: buf.length }));
  }
  async putObject(key: string, data: Uint8Array | string, opts: PutOptions = {}): Promise<PutResult> {
    const buf = toBuf(data);
    const hash = sha256Hex(buf);
    const mediaType = opts.mediaType ?? "application/octet-stream";
    await this.writeObject(key, buf, mediaType, hash);
    return { key, hash, bytes: buf.length, mediaType, url: this.objectUrl(key), created: true };
  }
  async getObject(key: string): Promise<StoredObject | null> {
    let data: Buffer;
    try {
      data = await readFile(this.abs(key));
    } catch (e: any) {
      if (e.code === "ENOENT" || e.code === "EISDIR") return null;
      throw e;
    }
    let mediaType = "application/octet-stream";
    try {
      mediaType = JSON.parse(await readFile(this.metaPath(key), "utf8")).mediaType ?? mediaType;
    } catch {
      /* no sidecar */
    }
    return { key, data, mediaType, hash: sha256Hex(data) };
  }
  async hasObject(key: string): Promise<boolean> {
    try {
      return (await stat(this.abs(key))).isFile();
    } catch {
      return false;
    }
  }
  async get(hash: string): Promise<StoredObject | null> {
    const obj = await this.getObject(blobKey(hash));
    if (obj && obj.hash !== hash) throw new Error(`blob ${hash} is corrupt (got ${obj.hash})`);
    return obj;
  }
  has(hash: string): Promise<boolean> {
    return this.hasObject(blobKey(hash));
  }
}

class S3BlobStore implements BlobStore {
  readonly driver = "s3" as const;
  private readonly endpoint: URL;
  private readonly bucket: string;
  private readonly region: string;
  private readonly creds: SigV4Credentials;
  private readonly publicUrl?: string;
  private readonly blobPublicUrl?: string;
  private readonly virtualHosted: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(env: StorageEnv, fetchImpl: typeof fetch = fetch) {
    for (const k of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
      if (!env[k]) throw new Error(`${k} is required for STORAGE_DRIVER=s3`);
    }
    this.endpoint = new URL(env.S3_ENDPOINT!);
    this.bucket = env.S3_BUCKET!;
    this.region = env.S3_REGION || "us-east-1";
    this.creds = {
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      sessionToken: env.S3_SESSION_TOKEN || undefined,
    };
    this.publicUrl = env.S3_PUBLIC_URL?.replace(/\/$/, "");
    this.blobPublicUrl = env.BLOB_PUBLIC_URL?.replace(/\/$/, "");
    this.virtualHosted = env.S3_VIRTUAL_HOSTED === "true";
    this.fetchImpl = fetchImpl;
  }

  private objectEndpoint(key: string): URL {
    const enc = checkKey(key)
      .split("/")
      .map((s) => encodeURIComponent(s))
      .join("/");
    const base = this.endpoint.toString().replace(/\/$/, "");
    if (this.virtualHosted) {
      const u = new URL(base);
      u.hostname = `${this.bucket}.${u.hostname}`;
      return new URL(`${u.toString().replace(/\/$/, "")}/${enc}`);
    }
    return new URL(`${base}/${encodeURIComponent(this.bucket)}/${enc}`);
  }

  private async request(method: string, key: string, body?: Buffer, headers: Record<string, string> = {}): Promise<Response> {
    const url = this.objectEndpoint(key);
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const signed = signRequest({ method, url, headers, body, region: this.region, credentials: this.creds });
      try {
        const res = await this.fetchImpl(url, { method, headers: signed, body: body ? new Uint8Array(body) : undefined });
        if (res.status >= 500) {
          lastErr = new Error(`s3 ${method} ${key}: HTTP ${res.status}`);
          await res.arrayBuffer().catch(() => undefined);
          await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
          continue;
        }
        return res;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  url(hash: string): string {
    if (this.blobPublicUrl) return `${this.blobPublicUrl}/${hash}`;
    return this.objectUrl(blobKey(hash));
  }
  objectUrl(key: string): string {
    if (this.publicUrl) return `${this.publicUrl}/${checkKey(key)}`;
    return this.objectEndpoint(key).toString();
  }
  async put(data: Uint8Array | string, opts: PutOptions = {}): Promise<PutResult> {
    const buf = toBuf(data);
    const hash = sha256Hex(buf);
    const key = blobKey(hash);
    const mediaType = opts.mediaType ?? "application/octet-stream";
    const exists = await this.hasObject(key);
    if (!exists) await this.write(key, buf, mediaType, hash, opts.cacheControl ?? "public, max-age=31536000, immutable");
    return { key, hash, bytes: buf.length, mediaType, url: this.url(hash), created: !exists };
  }
  private async write(key: string, buf: Buffer, mediaType: string, hash: string, cacheControl?: string) {
    const headers: Record<string, string> = { "content-type": mediaType, "x-amz-meta-sha256": hash };
    if (cacheControl) headers["cache-control"] = cacheControl;
    const res = await this.request("PUT", key, buf, headers);
    if (!res.ok) throw new Error(`s3 PUT ${key}: HTTP ${res.status} ${await res.text()}`);
    await res.arrayBuffer().catch(() => undefined);
  }
  async putObject(key: string, data: Uint8Array | string, opts: PutOptions = {}): Promise<PutResult> {
    const buf = toBuf(data);
    const hash = sha256Hex(buf);
    const mediaType = opts.mediaType ?? "application/octet-stream";
    await this.write(key, buf, mediaType, hash, opts.cacheControl);
    return { key, hash, bytes: buf.length, mediaType, url: this.objectUrl(key), created: true };
  }
  async getObject(key: string): Promise<StoredObject | null> {
    const res = await this.request("GET", key);
    if (res.status === 404) {
      await res.arrayBuffer().catch(() => undefined);
      return null;
    }
    if (!res.ok) throw new Error(`s3 GET ${key}: HTTP ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer());
    return { key, data, mediaType: res.headers.get("content-type") ?? "application/octet-stream", hash: sha256Hex(data) };
  }
  async hasObject(key: string): Promise<boolean> {
    const res = await this.request("HEAD", key);
    await res.arrayBuffer().catch(() => undefined);
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`s3 HEAD ${key}: HTTP ${res.status}`);
    return true;
  }
  async get(hash: string): Promise<StoredObject | null> {
    const obj = await this.getObject(blobKey(hash));
    if (obj && obj.hash !== hash) throw new Error(`blob ${hash} is corrupt (got ${obj.hash})`);
    return obj;
  }
  has(hash: string): Promise<boolean> {
    return this.hasObject(blobKey(hash));
  }
}
