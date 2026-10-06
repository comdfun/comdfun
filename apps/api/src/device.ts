/**
 * Device-signed HTTP calls (Ed25519 envelopes "comd.v2\n<KIND>\n<PAYLOAD_HASH>"): uploads of lease results
 * (bundles, artifacts), enrollment revocation, fuzz results and seat site publishing. Every payload carries a
 * single-use nonce and a short expiry; the signing device must hold an active enrollment, and lease-scoped calls
 * must name a lease that device currently holds.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEVICE_HEADERS, DEVICE_KEY_RE, HASH_RE, SITE_LABEL_RE, LIMITS, bundleHashOf, checkSignedEnvelope, sha256Hex, verifyEnvelope,
  type Attempt, type SignedEnvelope,
} from "@company/protocol";
import type { App } from "./app.ts";
import { ApiError, E } from "./errors.ts";
import type { ArtifactRecord, BundleRecord, EnrollmentRecord, FuzzRecord, NonceRecord, SiteRecord } from "./records.ts";
import { iso } from "./store.ts";
import type { JobX } from "./engine.ts";
import { sortFiles } from "./engine.ts";
import { mediaTypeFor, serveSiteFile, siteUrl } from "./sites-host.ts";
import { walk } from "./services.ts";

export const BUNDLE_LIMIT = 32 * 1024 * 1024;
export const ARTIFACT_LIMIT = 64 * 1024 * 1024;

export class Device {
  private readonly app: App;
  constructor(app: App) { this.app = app; }

  /** Verify an envelope, burn its nonce, and return the device's active enrollment. */
  auth(env: unknown, kind: string, opts: { allowRevoked?: boolean } = {}): { env: SignedEnvelope<any>; enrollment: EnrollmentRecord } {
    const chk = checkSignedEnvelope(env, kind, this.app.now());
    if (!chk.ok) throw new ApiError(chk.error === "invalid_envelope" ? 400 : 401, chk.error, chk.detail);
    const e = env as SignedEnvelope<any>;
    this.burnNonce(e.deviceKey, e.payload.nonce, e.payload.expiresAt);
    const enr = this.app.store.c<EnrollmentRecord>("enrollments").get(e.deviceKey);
    if (!enr || (enr.status !== "active" && !opts.allowRevoked)) throw E.forbidden("not_enrolled", "this device has no active enrollment");
    return { env: e, enrollment: enr };
  }

  burnNonce(deviceKey: string, nonce: string, expiresAt: number) {
    const col = this.app.store.c<NonceRecord>("nonces");
    const id = `${deviceKey}:${nonce}`;
    if (col.has(id)) throw E.conflict("nonce_reused", "this envelope nonce was already used");
    col.save({ id, createdAt: iso(this.app.now()), expiresAt });
    if (col.count() > 10_000) {
      const now = Math.floor(this.app.now() / 1000);
      for (const n of col.filter((x) => x.expiresAt < now)) col.delete(n.id);
    }
  }

  private lease(leaseId: unknown, enr: EnrollmentRecord): Attempt & { id: string; createdAt: string } {
    if (typeof leaseId !== "string") throw E.invalidRequest("payload.leaseId is required");
    const a = this.app.store.c<Attempt & { id: string; createdAt: string }>("attempts").get(leaseId);
    if (!a || a.deviceKey !== enr.deviceKey) throw E.forbidden("lease_not_held", "this device does not hold that lease");
    if (a.state !== "leased") throw E.conflict("lease_closed", `lease is ${a.state}`);
    return a;
  }

  // ------------------------------------------------------------------------------------------ bundles

  async uploadBundle(body: unknown) {
    const { env, enrollment } = this.auth(body, "bundle.upload");
    const a = this.lease(env.payload.leaseId, enrollment);
    const files = env.payload.files;
    if (!Array.isArray(files) || files.length > 2000) throw E.invalidRequest("payload.files must be an array of at most 2000 files");
    const seen = new Set<string>();
    const decoded: { path: string; data: Buffer; mediaType: string }[] = [];
    let total = 0;
    for (const [i, f] of files.entries()) {
      if (!f || typeof f.path !== "string" || typeof f.data !== "string") throw E.invalidRequest(`files[${i}] needs path and data (base64)`);
      const p = path.posix.normalize(f.path);
      if (p !== f.path || p.startsWith("..") || p.startsWith("/") || p.includes("\0") || p.length > 512 || p.split("/").some((s: string) => s === "" || s === ".git")) throw new ApiError(400, "invalid_upload", `unsafe path ${f.path}`);
      if (seen.has(p)) throw new ApiError(400, "invalid_upload", `duplicate path ${p}`);
      seen.add(p);
      const data = Buffer.from(f.data, "base64");
      total += data.length;
      if (total > BUNDLE_LIMIT) throw E.tooLarge(BUNDLE_LIMIT);
      if (f.sha256 !== undefined && f.sha256 !== sha256Hex(data)) throw new ApiError(400, "invalid_upload", `sha256 mismatch for ${p}`);
      decoded.push({ path: p, data, mediaType: typeof f.mediaType === "string" ? f.mediaType.slice(0, 128) : mediaTypeFor(p) });
    }
    const manifest = sortFiles(decoded.map((f) => ({ path: f.path, sha256: sha256Hex(f.data), bytes: f.data.length, mediaType: f.mediaType })));
    const hash = bundleHashOf(manifest);
    const col = this.app.store.c<BundleRecord>("bundles");
    // identical bundles are normal (panel members agreeing byte for byte): attach this lease to the existing record.
    // Re-checked after the async blob writes so two concurrent uploads of the same bytes both keep their lease.
    const attach = (existing: BundleRecord) => {
      if (!existing.leaseIds.includes(a.leaseId)) existing.leaseIds.push(a.leaseId);
      if (!existing.tokenIds.includes(a.tokenId)) existing.tokenIds.push(a.tokenId);
      col.save(existing);
      return { status: 200, body: this.bundleView(existing) };
    };
    const existing = col.get(hash);
    if (existing) return attach(existing);
    for (const f of decoded) await this.app.blobs.put(f.data, { mediaType: f.mediaType });
    await this.app.blobs.putObject(`bundles/${hash}.json`, JSON.stringify(manifest), { mediaType: "application/json" });
    const raced = col.get(hash);
    if (raced) return attach(raced);
    const rec: BundleRecord = { id: hash, createdAt: iso(this.app.now()), leaseId: a.leaseId, jobId: a.jobId, nodeKey: a.nodeKey, tokenId: a.tokenId, deviceKey: a.deviceKey, files: manifest, bytes: total, leaseIds: [a.leaseId], tokenIds: [a.tokenId] };
    col.save(rec);
    return { status: 201, body: this.bundleView(rec) };
  }

  bundleView(b: BundleRecord) {
    const api = this.app.cfg.publicApiUrl;
    return { hash: b.id, leaseId: b.leaseId, jobId: b.jobId, nodeKey: b.nodeKey, tokenId: b.tokenId, bytes: b.bytes, createdAt: b.createdAt, files: b.files.map((f) => ({ ...f, url: `${api}/artifacts/${f.sha256}` })) };
  }

  // ------------------------------------------------------------------------------------------ artifacts

  async uploadArtifact(headers: Record<string, string | string[] | undefined>, body: Buffer) {
    const h = (k: string) => { const v = headers[k]; return Array.isArray(v) ? v[0] : v; };
    const deviceKey = h(DEVICE_HEADERS.device);
    const payloadB64 = h(DEVICE_HEADERS.payload);
    const signature = h(DEVICE_HEADERS.signature);
    if (!deviceKey || !DEVICE_KEY_RE.test(deviceKey) || !payloadB64 || !signature) throw E.unauthorized("signature_required", `send ${DEVICE_HEADERS.device}, ${DEVICE_HEADERS.payload} and ${DEVICE_HEADERS.signature}`);
    let payload: any;
    try { payload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8")); } catch { throw E.invalidRequest("x-company-payload must be base64 JSON"); }
    const { enrollment } = this.auth({ v: 2, kind: "artifact.upload", deviceKey, payload, signature }, "artifact.upload");
    const a = this.lease(payload.leaseId, enrollment);
    if (payload.sha256 !== sha256Hex(body) || payload.bytes !== body.length) throw new ApiError(400, "invalid_upload", "body does not match payload.sha256/bytes");
    const mediaType = typeof payload.mediaType === "string" ? payload.mediaType.slice(0, 128) : "application/octet-stream";
    const put = await this.app.blobs.put(body, { mediaType });
    const rec: ArtifactRecord = { id: put.hash, createdAt: iso(this.app.now()), leaseId: a.leaseId, jobId: a.jobId, name: typeof payload.name === "string" ? payload.name.slice(0, 200) : null, mediaType, bytes: body.length, deviceKey };
    this.app.store.c<ArtifactRecord>("artifacts").save(rec);
    return { hash: put.hash, bytes: body.length, mediaType, url: `${this.app.cfg.publicApiUrl}/artifacts/${put.hash}` };
  }

  async getArtifact(hash: string) {
    if (!HASH_RE.test(hash)) throw E.invalidId("artifact hash must be 64 lowercase hex");
    const obj = await this.app.blobs.get(hash);
    if (!obj) throw new ApiError(404, "unknown_artifact", "no artifact with that hash");
    const rec = this.app.store.c<ArtifactRecord>("artifacts").get(hash);
    return { status: 200, raw: obj.data, headers: { "content-type": rec?.mediaType ?? obj.mediaType, "cache-control": "public, max-age=31536000, immutable", etag: `"${hash}"`, "access-control-allow-origin": "*" } };
  }

  // ------------------------------------------------------------------------------------------ revoke

  revoke(body: unknown) {
    const { env, enrollment } = this.auth(body, "enrollment.revoke", { allowRevoked: true });
    if (env.payload.deviceKey !== undefined && env.payload.deviceKey !== env.deviceKey) throw E.forbidden("not_own_device", "a device may only revoke its own enrollment");
    if (enrollment.status === "revoked") return { deviceKey: enrollment.deviceKey, status: "revoked", reason: enrollment.reason };
    this.app.pairing.revoke(enrollment, typeof env.payload.reason === "string" ? env.payload.reason.slice(0, 200) : "unlinked by device");
    return { deviceKey: enrollment.deviceKey, tokenId: enrollment.tokenId, status: "revoked", reason: enrollment.reason };
  }

  verifyRaw(deviceKey: string, kind: string, payload: unknown, signature: string) {
    return verifyEnvelope(deviceKey, kind, payload, signature);
  }
}

// ============================================================================================ fuzz

export class Fuzz {
  private readonly app: App;
  constructor(app: App) { this.app = app; }
  private get col() { return this.app.store.c<FuzzRecord>("fuzz"); }

  result(body: unknown) {
    const { env, enrollment } = this.app.device.auth(body, "fuzz.result");
    const p = env.payload;
    const a = this.app.store.c<Attempt & { id: string; createdAt: string }>("attempts").get(String(p.leaseId));
    if (!a || a.deviceKey !== enrollment.deviceKey) throw E.forbidden("lease_not_held", "this device does not hold that lease");
    if (!["leased", "submitted"].includes(a.state)) throw E.conflict("lease_closed", `lease is ${a.state}`);
    const job = this.app.store.c<JobX>("jobs").get(a.jobId)!;
    const node = job.nodes.find((n) => n.key === a.nodeKey)!;
    if (node.variables.mode !== "fuzz") throw E.invalidRequest("this lease is not a fuzz campaign");
    const runs = Number(p.runs);
    if (!Number.isInteger(runs) || runs < 1 || runs > LIMITS.fuzz.maxRuns) throw E.invalidRequest("runs must be an integer within the campaign limit");
    if (!Array.isArray(p.properties) || p.properties.length > 200) throw E.invalidRequest("properties must be an array (≤200)");
    const props = p.properties.map((x: any) => ({
      name: String(x?.name ?? "").slice(0, 200),
      status: x?.status === "fail" ? ("fail" as const) : ("pass" as const),
      ...(typeof x?.counterexample === "string" ? { counterexample: x.counterexample.slice(0, 4000) } : {}),
      ...(typeof x?.reproduction === "string" ? { reproduction: x.reproduction.slice(0, 4000) } : {}),
      confirmed: x?.status === "fail" && typeof x?.counterexample === "string" && typeof x?.reproduction === "string",
    }));
    const now = iso(this.app.now());
    const rec = this.col.get(job.id) ?? { id: job.id, createdAt: now, updatedAt: now, jobId: job.id, state: "running" as const, runs: 0, confirmed: 0, results: [] };
    rec.results.push({ leaseId: a.leaseId, tokenId: a.tokenId, runs, properties: props, at: now });
    rec.runs = Math.max(rec.runs, runs);
    rec.confirmed = rec.results.flatMap((r) => r.properties).filter((x) => x.confirmed).length;
    rec.updatedAt = now;
    this.col.save(rec);
    this.app.event("fuzz.result", { jobId: job.id, runs, failures: props.filter((x: any) => x.status === "fail").length });
    return { jobId: job.id, state: rec.state, runs: rec.runs, confirmed: rec.confirmed };
  }

  onNodeAccepted(job: JobX, _node: unknown, _sub: unknown) {
    const now = iso(this.app.now());
    const rec = this.col.get(job.id) ?? { id: job.id, createdAt: now, updatedAt: now, jobId: job.id, state: "running" as const, runs: 0, confirmed: 0, results: [] };
    rec.state = rec.confirmed > 0 ? "confirmed" : rec.results.length ? "clean" : "failed";
    rec.updatedAt = now;
    this.col.save(rec);
  }

  view(jobId: string) {
    const r = this.col.get(jobId);
    if (!r) return null;
    return { jobId, state: r.state, runs: r.runs, confirmed: r.confirmed, results: r.results };
  }

  list(limit: number) {
    const rows = this.col.newest({ limit });
    return { count: rows.length, confirmed: rows.reduce((s, r) => s + r.confirmed, 0), results: rows.map((r) => ({ jobId: r.jobId, state: r.state, runs: r.runs, confirmed: r.confirmed, updatedAt: r.updatedAt })) };
  }
}

// ============================================================================================ sites

const EXPORT_DIRS = ["dist", "out", "build", "site", "public", "."];

export class Sites {
  private readonly app: App;
  constructor(app: App) { this.app = app; }
  private get col() { return this.app.store.c<SiteRecord>("sites"); }

  private liveByLabel(label: string): SiteRecord | undefined {
    return this.col.newest({ filter: (s) => s.label === label && (s.status === "live" || s.status === "held") })[0];
  }

  /** Host a finished job's static export at https://<label>.<SITES_DOMAIN>. */
  async publishForJob(job: JobX, dir: string) {
    let distDir: string | null = null;
    for (const d of EXPORT_DIRS) {
      const files = await walk(path.join(dir, d));
      if (files.some((f) => f.path === "index.html")) { distDir = path.join(dir, d); break; }
    }
    if (!distDir) throw new Error("no static export with an index.html (looked in dist/, out/, build/, site/, public/, ./)");
    let label = typeof job.host === "string" ? job.host : `m-${job.id.slice(0, 8)}`;
    const holder = this.liveByLabel(label);
    const projectId = job.project?.id ?? job.id;
    if (holder && holder.jobId) {
      const hj = this.app.store.c<JobX>("jobs").get(holder.jobId);
      const sameProject = hj && (hj.project?.id ?? hj.id) === projectId;
      const sameOwner = hj?.paidBy && hj.paidBy === job.paidBy;
      if (!sameProject && !sameOwner) label = `${label.slice(0, 26)}-${job.id.slice(0, 4)}`;
    } else if (holder && holder.kind === "seat") label = `${label.slice(0, 26)}-${job.id.slice(0, 4)}`;
    const site = await this.publish({ label, distDir, kind: job.launch.requested ? "launch" : job.workflow ? "workflow" : "job", jobId: job.id, tokenId: null, owner: job.paidBy });
    job.site = { label: site.label, url: site.url, siteId: site.id, status: site.status };
    this.app.store.c<JobX>("jobs").save(job);
  }

  private async publish(x: { label: string; distDir: string; kind: SiteRecord["kind"]; jobId: string | null; tokenId: string | null; owner: string | null }): Promise<SiteRecord> {
    const now = iso(this.app.now());
    const prev = this.liveByLabel(x.label);
    const rec: SiteRecord = {
      id: this.app.pairing.newId(), createdAt: now, updatedAt: now, jobId: x.jobId, kind: x.kind, tokenId: x.tokenId, agentId: x.tokenId ? this.app.pairing.seat(x.tokenId).agentId : null,
      owner: (x.owner as any) ?? null, url: siteUrl(x.label, this.app.cfg.sitesDomain), status: "publishing", holdReason: null, takenDownAt: null, takenDownReason: null, label: x.label,
      version: null, bytes: 0, files: 0, attempts: 1, failure: null, publishedAt: null, supersededBy: null, supersededAt: null,
    };
    this.col.save(rec);
    try {
      const r = await this.app.services.publishSite({ label: x.label, distDir: x.distDir });
      Object.assign(rec, { status: "live", url: r.url, version: r.version, bytes: r.bytes, files: r.files, publishedAt: iso(this.app.now()), updatedAt: iso(this.app.now()) });
      this.col.save(rec);
      if (prev && prev.id !== rec.id) {
        Object.assign(prev, { status: "superseded", supersededBy: rec.id, supersededAt: iso(this.app.now()), updatedAt: iso(this.app.now()) });
        this.col.save(prev);
      }
      this.app.event("site.live", { siteId: rec.id, label: rec.label, url: rec.url });
      return rec;
    } catch (e) {
      Object.assign(rec, { status: "failed", failure: (e as Error).message.slice(0, 500), updatedAt: iso(this.app.now()) });
      this.col.save(rec);
      throw e;
    }
  }

  /** POST /sites/publish — a seat publishes a static site from one of its bundles (10 per seat per day). */
  async devicePublish(body: unknown) {
    const { env, enrollment } = this.app.device.auth(body, "site.publish");
    const p = env.payload;
    const label = String(p.label ?? "");
    if (!SITE_LABEL_RE.test(label)) throw new ApiError(400, "invalid_label", "label must match ^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$");
    const bundle = this.app.store.c<BundleRecord>("bundles").get(String(p.bundleHash ?? ""));
    if (!bundle || !bundle.tokenIds.includes(enrollment.tokenId)) throw E.notFound("unknown bundle for this seat");
    const holder = this.liveByLabel(label);
    if (holder && !(holder.kind === "seat" && holder.tokenId === enrollment.tokenId)) throw E.conflict("name_taken", `${label} is taken`);
    const seat = this.app.pairing.seat(enrollment.tokenId);
    const day = iso(this.app.now()).slice(0, 10);
    if (seat.sitesToday.day !== day) seat.sitesToday = { day, count: 0 };
    if (seat.sitesToday.count >= LIMITS.sitesPerSeatPerDay) throw E.rate("publication_quota", Math.ceil((Date.parse(`${day}T00:00:00Z`) + 86_400_000 - this.app.now()) / 1000));
    seat.sitesToday.count++;
    this.app.pairing.seats.save(seat);
    const dir = await mkdtemp(path.join(tmpdir(), "company-site-"));
    try {
      const { writeFile, mkdir } = await import("node:fs/promises");
      for (const f of bundle.files) {
        const obj = await this.app.blobs.get(f.sha256);
        if (!obj) throw new Error(`missing blob for ${f.path}`);
        const abs = path.join(dir, ...f.path.split("/"));
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, obj.data);
      }
      const root = (await walk(path.join(dir, "dist"))).some((f) => f.path === "index.html") ? path.join(dir, "dist") : dir;
      const rec = await this.publish({ label, distDir: root, kind: "seat", jobId: null, tokenId: enrollment.tokenId, owner: enrollment.wallet });
      return { siteId: rec.id, status: rec.status, label: rec.label, url: rec.url, site: { label: rec.label, url: rec.url }, remainingToday: LIMITS.sitesPerSeatPerDay - seat.sitesToday.count };
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(422, "invalid_input", (e as Error).message, { problems: [{ path: "bundleHash", code: "invalid_site", message: (e as Error).message }] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  view(s: SiteRecord) {
    return { ...s, site: { label: s.label, url: s.url } };
  }

  list() {
    const all = this.col.newest();
    return { count: Math.min(100, all.length), total: all.length, live: all.filter((s) => s.status === "live").length, sites: all.slice(0, 100).map((s) => this.view(s)) };
  }

  byLabel(label: string) {
    if (!SITE_LABEL_RE.test(label)) throw new ApiError(400, "invalid_label", "bad label");
    const s = this.liveByLabel(label);
    if (!s) throw E.notFound("no live site with that label");
    return this.view(s);
  }

  names() {
    const live = this.col.newest({ filter: (s) => s.status === "live" });
    return { domain: this.app.cfg.sitesDomain, resolver: "chambers", count: live.length, names: live.map((s) => this.nameView(s)) };
  }

  nameView(s: SiteRecord) {
    // `address`: the wallet the name resolves to (the site's owner); the web reads {label, name, address}
    return { name: `${s.label}.${this.app.cfg.sitesDomain}`, label: s.label, address: s.owner ?? null, url: s.url, siteId: s.id, kind: s.kind, jobId: s.jobId, tokenId: s.tokenId, owner: s.owner, version: s.version, updatedAt: s.updatedAt };
  }

  name(label: string) {
    const s = this.liveByLabel(label);
    if (!s) throw E.notFound("name not registered");
    return this.nameView(s);
  }

  /** Host-header routing: returns null when the host is not a sites host. */
  async serve(host: string | undefined, reqPath: string, method: string, ifNoneMatch?: string) {
    if (!host) return null;
    const h = host.split(":")[0].toLowerCase();
    const suffix = `.${this.app.cfg.sitesDomain.toLowerCase()}`;
    if (!h.endsWith(suffix)) return null;
    const label = h.slice(0, -suffix.length);
    if (!label || label.includes(".")) return null;
    const live = this.liveByLabel(label);
    if (live?.status === "held") return { status: 451, headers: { "content-type": "text/plain" }, body: Buffer.from(`held: ${live.holdReason ?? ""}`) };
    // @company/services serveSite (ETag/304, cache-control, SPA fallback, per-file hash check) over the BlobStore
    if (this.app.services.serveSite) return this.app.services.serveSite(label, reqPath, { method, ifNoneMatch });
    return serveSiteFile(this.app.blobs, label, reqPath, method);
  }
}
