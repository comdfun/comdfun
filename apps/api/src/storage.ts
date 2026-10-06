/**
 * Blob storage. The interface mirrors `@company/services` createBlobStore() so the two are interchangeable:
 * `loadBlobStore()` uses the services driver (local dir or S3) when that package is installed, and falls back to
 * the local-directory driver below otherwise. Content-addressed blobs live at `blobs/<hh>/<sha256>`; named objects
 * (site files, bundle manifests) at caller-chosen keys.
 */
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import path from "node:path";

export interface PutOptions { mediaType?: string; cacheControl?: string }
export interface PutResult { key: string; hash: string; bytes: number; mediaType: string; url: string; created: boolean }
export interface StoredObject { key: string; data: Buffer; mediaType: string; hash: string }

export interface BlobStore {
  readonly driver: "local" | "s3" | "memory";
  put(data: Uint8Array | string, opts?: PutOptions): Promise<PutResult>;
  get(hash: string): Promise<StoredObject | null>;
  has(hash: string): Promise<boolean>;
  url(hash: string): string;
  putObject(key: string, data: Uint8Array | string, opts?: PutOptions): Promise<PutResult>;
  getObject(key: string): Promise<StoredObject | null>;
  hasObject(key: string): Promise<boolean>;
  objectUrl(key: string): string;
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const toBuf = (d: Uint8Array | string) => (typeof d === "string" ? Buffer.from(d, "utf8") : Buffer.from(d.buffer, d.byteOffset, d.byteLength));

export function blobKey(hash: string): string {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`bad blob hash: ${hash}`);
  return `blobs/${hash.slice(0, 2)}/${hash}`;
}

function checkKey(key: string): string {
  if (!key || key.startsWith("/") || key.includes("\\") || key.split("/").some((s) => s === ".." || s === "." || s === "")) throw new Error(`invalid object key: ${key}`);
  return key;
}

/** Local directory driver (Railway volume). */
export class LocalBlobStore implements BlobStore {
  readonly driver = "local" as const;
  readonly dir: string;
  private readonly base: string;
  constructor(dir: string, publicBase: string) {
    this.dir = path.resolve(dir);
    this.base = publicBase.replace(/\/$/, "");
  }
  private abs(key: string) { return path.join(this.dir, ...checkKey(key).split("/")); }
  private meta(key: string) { return path.join(this.dir, ".meta", ...checkKey(key).split("/")) + ".json"; }
  private async write(file: string, data: Uint8Array | string) {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, file);
  }
  url(hash: string) { return `${this.base}/artifacts/${hash}`; }
  objectUrl(key: string) { return `${this.base}/storage/${checkKey(key)}`; }
  async put(data: Uint8Array | string, opts: PutOptions = {}): Promise<PutResult> {
    const buf = toBuf(data);
    const hash = sha(buf);
    const key = blobKey(hash);
    const exists = await this.hasObject(key);
    const mediaType = opts.mediaType ?? "application/octet-stream";
    if (!exists) await this.putObject(key, buf, { mediaType });
    return { key, hash, bytes: buf.length, mediaType, url: this.url(hash), created: !exists };
  }
  async get(hash: string) {
    const o = await this.getObject(blobKey(hash));
    if (o && o.hash !== hash) throw new Error(`blob ${hash} is corrupt`);
    return o;
  }
  has(hash: string) { return this.hasObject(blobKey(hash)); }
  async putObject(key: string, data: Uint8Array | string, opts: PutOptions = {}): Promise<PutResult> {
    const buf = toBuf(data);
    const mediaType = opts.mediaType ?? "application/octet-stream";
    await this.write(this.abs(key), buf);
    await this.write(this.meta(key), JSON.stringify({ mediaType, hash: sha(buf), bytes: buf.length }));
    return { key, hash: sha(buf), bytes: buf.length, mediaType, url: this.objectUrl(key), created: true };
  }
  async getObject(key: string): Promise<StoredObject | null> {
    let data: Buffer;
    try { data = await readFile(this.abs(key)); } catch (e: any) { if (e.code === "ENOENT" || e.code === "EISDIR") return null; throw e; }
    let mediaType = "application/octet-stream";
    try { mediaType = JSON.parse(await readFile(this.meta(key), "utf8")).mediaType ?? mediaType; } catch { /* no sidecar */ }
    return { key, data, mediaType, hash: sha(data) };
  }
  async hasObject(key: string) {
    try { return (await stat(this.abs(key))).isFile(); } catch { return false; }
  }
}

/** In-process driver for tests. */
export class MemoryBlobStore implements BlobStore {
  readonly driver = "memory" as const;
  private objs = new Map<string, { data: Buffer; mediaType: string }>();
  private readonly base: string;
  constructor(publicBase = "http://localhost") { this.base = publicBase.replace(/\/$/, ""); }
  url(hash: string) { return `${this.base}/artifacts/${hash}`; }
  objectUrl(key: string) { return `${this.base}/storage/${key}`; }
  async put(data: Uint8Array | string, opts: PutOptions = {}) {
    const buf = toBuf(data);
    const hash = sha(buf);
    const key = blobKey(hash);
    const created = !this.objs.has(key);
    if (created) this.objs.set(key, { data: buf, mediaType: opts.mediaType ?? "application/octet-stream" });
    return { key, hash, bytes: buf.length, mediaType: opts.mediaType ?? "application/octet-stream", url: this.url(hash), created };
  }
  async get(hash: string) { return this.getObject(blobKey(hash)); }
  async has(hash: string) { return this.objs.has(blobKey(hash)); }
  async putObject(key: string, data: Uint8Array | string, opts: PutOptions = {}) {
    const buf = toBuf(checkKey(key) && data);
    this.objs.set(key, { data: buf, mediaType: opts.mediaType ?? "application/octet-stream" });
    return { key, hash: sha(buf), bytes: buf.length, mediaType: opts.mediaType ?? "application/octet-stream", url: this.objectUrl(key), created: true };
  }
  async getObject(key: string) {
    const o = this.objs.get(key);
    return o ? { key, data: o.data, mediaType: o.mediaType, hash: sha(o.data) } : null;
  }
  async hasObject(key: string) { return this.objs.has(key); }
}

/** STORAGE_DRIVER=local|s3 via @company/services when available; local fallback otherwise. */
export async function loadBlobStore(env: Record<string, string | undefined>): Promise<BlobStore> {
  try {
    const mod: any = await import("@company/services");
    if (typeof mod.createBlobStore === "function") return mod.createBlobStore(env) as BlobStore;
  } catch (e) {
    if ((env.STORAGE_DRIVER ?? "local") === "s3") throw new Error(`STORAGE_DRIVER=s3 needs @company/services: ${(e as Error).message}`);
  }
  return new LocalBlobStore(env.STORAGE_DIR || "./storage", env.PUBLIC_API_URL || "http://localhost:8787");
}
