/**
 * The worker daemon: one WebSocket session to Chambers for one seat. Answers the challenge with a signed hello,
 * heartbeats, runs assignments up to `concurrency` at a time, uploads results as signed bundles, submits from the
 * durable outbox (replayed after reconnects), hands leases back and pauses five minutes when the runtime is
 * rate-limited, and drains (no new work) before an update.
 */
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  CLOSE, DEVICE_HEADERS, canonicalJson, makeSignedEnvelope, randomHex, sha256Hex, signEnvelope, signFrame, submissionHash,
  type ClientFrameType, type DeviceKeyPair, type HelloBody, type Lease, type ServerFrame, type ToolInfo,
} from "@company/protocol";
import { Outbox, type OutboxItem } from "./outbox.ts";
import { RateLimited, type Runtime } from "./runtimes.ts";

export const RATE_LIMIT_PAUSE_MS = 5 * 60_000;
const PERMANENT = new Set(["lease_closed", "unknown_lease", "lease_expired", "invalid_submission", "unknown_bundle"]);

export interface DaemonOptions {
  server: string;
  wsUrl: string;
  tokenId: string;
  key: DeviceKeyPair;
  runtime: Runtime;
  tools: ToolInfo;
  skills: string[];
  concurrency: number;
  home: string;
  version: string;
  reconnect?: boolean;
  log?: (m: string) => void;
  fetch?: typeof fetch;
}

export interface DaemonStatus { connected: boolean; active: number; outbox: number; paused: boolean; pausedUntil: number | null; completed: number; failed: number; lastError: string | null }

export class Daemon extends EventEmitter {
  private ws: WebSocket | null = null;
  private session = "";
  private seq = 0;
  private hb: NodeJS.Timeout | null = null;
  private stopped = false;
  private backoff = 500;
  private readonly active = new Map<string, AbortController>();
  private readonly acks = new Map<string, (f: Extract<ServerFrame, { type: "ack" }>) => void>();
  private pausedUntil = 0;
  private draining = false;
  readonly outbox: Outbox;
  readonly status: DaemonStatus;
  private readonly o: DaemonOptions;
  private readonly http: typeof fetch;

  constructor(o: DaemonOptions) {
    super();
    this.o = o;
    this.http = o.fetch ?? fetch;
    this.outbox = new Outbox(o.home);
    this.status = { connected: false, active: 0, outbox: this.outbox.size, paused: false, pausedUntil: null, completed: 0, failed: 0, lastError: null };
  }

  private log(m: string) { this.o.log?.(`[#${this.o.tokenId}] ${m}`); }

  get paused(): boolean { return this.draining || this.pausedUntil > Date.now(); }

  start(): Promise<void> {
    this.stopped = false;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.o.wsUrl, { maxPayload: 16 * 1024 * 1024 });
      this.ws = ws;
      let welcomed = false;
      ws.on("message", (data) => {
        let f: ServerFrame;
        try { f = JSON.parse(String(data)); } catch { return; }
        if (f.type === "welcome") { welcomed = true; resolve(); }
        if (f.type === "disconnect" && !welcomed) reject(new Error(`refused: ${f.reason}`));
        this.onFrame(f).catch((e) => this.log(`handler error: ${(e as Error).message}`));
      });
      ws.on("close", (code, reason) => {
        this.status.connected = false;
        if (this.hb) clearInterval(this.hb);
        this.emit("disconnected", code, String(reason));
        if (!welcomed) reject(new Error(`connection closed before welcome (${code} ${reason})`));
        const fatal = [CLOSE.notEnrolled, CLOSE.notRegistered, CLOSE.ownershipChanged, CLOSE.superseded].includes(code as any);
        if (!this.stopped && this.o.reconnect !== false && !fatal) {
          const wait = this.backoff + Math.floor(Math.random() * 250);
          this.backoff = Math.min(this.backoff * 2, 30_000);
          setTimeout(() => this.start().catch(() => undefined), wait).unref();
        }
      });
      ws.on("error", (e) => { this.status.lastError = e.message; if (!welcomed) reject(e); });
    });
  }

  async stop() {
    this.stopped = true;
    if (this.hb) clearInterval(this.hb);
    for (const a of this.active.values()) a.abort();
    if (this.ws?.readyState === WebSocket.OPEN) {
      await this.send("disconnect", { reason: "operator stopped the worker" }, 2000).catch(() => undefined);
      this.ws.close(1000);
    }
  }

  /** Stop taking new work and resolve when nothing is running (used before an update). */
  async drain(): Promise<void> {
    this.draining = true;
    await this.heartbeat();
    while (this.active.size > 0) await new Promise((r) => setTimeout(r, 1000));
  }

  /** Simulate a network drop (tests). */
  drop() { this.ws?.terminate(); }

  private frame(type: ClientFrameType, body: unknown, id: string = randomUUID()) {
    return signFrame(this.o.key.privateKeyPem, this.o.key.deviceKey, this.session, { type, id, seq: ++this.seq, ts: Date.now(), body });
  }

  private send(type: ClientFrameType, body: unknown, timeoutMs = 15_000, id?: string): Promise<Extract<ServerFrame, { type: "ack" }>> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return reject(new Error("not connected"));
      const f = this.frame(type, body, id);
      const t = setTimeout(() => { this.acks.delete(f.id); reject(new Error(`no ack for ${type}`)); }, timeoutMs);
      this.acks.set(f.id, (a) => { clearTimeout(t); resolve(a); });
      this.ws.send(JSON.stringify(f));
    });
  }

  private heartbeat() {
    return this.send("heartbeat", { active: [...this.active.keys()], paused: this.paused, pausedUntil: this.pausedUntil > Date.now() ? this.pausedUntil : null }).catch(() => undefined);
  }

  private async onFrame(f: ServerFrame) {
    switch (f.type) {
      case "challenge": {
        this.session = f.nonce;
        this.seq = 0;
        const body: HelloBody = { nonce: f.nonce, tokenId: this.o.tokenId, version: this.o.version, runtime: this.o.runtime.info, concurrency: this.o.concurrency, skills: this.o.skills, tools: this.o.tools, paused: this.paused };
        this.ws!.send(JSON.stringify(this.frame("hello", body)));
        return;
      }
      case "welcome": {
        this.status.connected = true;
        this.backoff = 500;
        this.log(`connected: Counsel #${f.tokenId}${f.agentId ? ` (agent ${f.agentId})` : ""}, ${f.leases.length} open lease(s), outbox ${this.outbox.size}${f.premium ? ", premium" : ""}`);
        if (this.hb) clearInterval(this.hb);
        this.hb = setInterval(() => void this.heartbeat(), f.heartbeatMs);
        this.hb.unref();
        this.emit("welcome", f);
        await this.flush();
        for (const l of f.leases) if (!this.active.has(l.leaseId) && !this.outbox.has(l.leaseId)) this.runLease(l);
        return;
      }
      case "ack": { this.acks.get(f.ref)?.(f); this.acks.delete(f.ref); return; }
      case "assignment": {
        if (this.paused) { await this.send("cancel", { leaseId: f.lease.leaseId, reason: "worker paused" }).catch(() => undefined); return; }
        this.runLease(f.lease);
        return;
      }
      case "cancel": {
        const a = this.active.get(f.leaseId);
        if (a) { a.abort(); this.active.delete(f.leaseId); this.status.active = this.active.size; this.log(`lease ${f.leaseId.slice(0, 8)} cancelled: ${f.reason}`); }
        this.emit("cancel", f);
        return;
      }
      case "lease": this.emit("lease", f); return;
      case "disconnect": this.log(`disconnected by Chambers: ${f.reason}`); this.emit("refused", f); return;
      case "error": this.status.lastError = `${f.error}: ${f.detail ?? ""}`; this.log(`error: ${f.error} ${f.detail ?? ""}`); return;
      case "heartbeat": return;
    }
  }

  private runLease(lease: Lease) {
    const ac = new AbortController();
    this.active.set(lease.leaseId, ac);
    this.status.active = this.active.size;
    this.emit("assignment", lease);
    this.log(`lease ${lease.leaseId.slice(0, 8)}: ${lease.skill} (${lease.kind}) on ${lease.jobId.slice(0, 8)}/${lease.nodeKey}`);
    void (async () => {
      try {
        const out = await this.o.runtime.run({
          lease, tokenId: this.o.tokenId, signal: ac.signal,
          fetchFile: (h) => this.getBytes(`/artifacts/${h}`),
          fetchBundle: async (h) => JSON.parse((await this.getBytes(`/bundles/${h}`)).toString("utf8")),
          progress: (note) => void this.send("progress", { leaseId: lease.leaseId, note }).catch(() => undefined),
        });
        if (ac.signal.aborted) return;
        if (out.fuzz) await this.postSigned("/fuzz/result", "fuzz.result", { leaseId: lease.leaseId, ...out.fuzz });
        const item: OutboxItem = {
          id: `sub-${lease.leaseId}`, leaseId: lease.leaseId, jobId: lease.jobId, nodeKey: lease.nodeKey,
          files: out.files.map((f) => ({ path: f.path, mediaType: f.mediaType, data: f.data.toString("base64"), sha256: sha256Hex(f.data), bytes: f.data.length })),
          result: out.result, summary: out.summary, usage: out.usage, runtime: this.o.runtime.info, bundleHash: null, bundleFiles: null, createdAt: Date.now(), attempts: 0,
        };
        this.outbox.put(item);
        this.status.outbox = this.outbox.size;
        await this.flush();
      } catch (e) {
        if (ac.signal.aborted) return;
        if (e instanceof RateLimited) {
          this.pausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
          this.status.paused = true;
          this.status.pausedUntil = this.pausedUntil;
          this.log(`${e.message}: handing the lease back and pausing new work for 5 minutes`);
          await this.send("cancel", { leaseId: lease.leaseId, reason: "runtime rate-limited" }).catch(() => undefined);
          await this.heartbeat();
          setTimeout(() => { this.status.paused = this.paused; void this.heartbeat(); }, RATE_LIMIT_PAUSE_MS + 50).unref();
          this.emit("paused", this.pausedUntil);
        } else {
          this.status.failed++;
          this.status.lastError = (e as Error).message;
          this.log(`lease ${lease.leaseId.slice(0, 8)} failed: ${(e as Error).message}`);
          await this.send("cancel", { leaseId: lease.leaseId, reason: `runtime error: ${(e as Error).message.slice(0, 160)}` }).catch(() => undefined);
        }
      } finally {
        this.active.delete(lease.leaseId);
        this.status.active = this.active.size;
      }
    })();
  }

  private flushing = false;
  private again = false;
  /** Upload bundles and submit every outbox item, in order; keep the rest when disconnected. */
  async flush(): Promise<void> {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (this.flushing) { this.again = true; return; }
    this.flushing = true;
    try {
      do {
        this.again = false;
        for (const it of this.outbox.list()) {
          it.attempts++;
          this.outbox.put(it);
          try {
            if (!it.bundleHash && it.files.length) {
              const r = await this.postSigned("/bundles", "bundle.upload", { leaseId: it.leaseId, files: it.files.map((f) => ({ path: f.path, mediaType: f.mediaType, data: f.data, sha256: f.sha256 })) });
              if (!r.ok) {
                if ([403, 409, 400].includes(r.status) && /lease_closed|lease_not_held|invalid_upload/.test(r.text)) { this.drop_(it, `bundle refused: ${r.text.slice(0, 160)}`); continue; }
                throw new Error(`bundle upload failed: ${r.status} ${r.text.slice(0, 160)}`);
              }
              const b = JSON.parse(r.text);
              it.bundleHash = b.hash;
              it.bundleFiles = b.files.map((f: any) => ({ path: f.path, sha256: f.sha256, bytes: f.bytes, mediaType: f.mediaType }));
              this.outbox.put(it);
            }
            const files = it.bundleFiles ?? [];
            const hash = submissionHash(it.leaseId, it.bundleHash, files, it.result);
            const a = await this.send("submission", { leaseId: it.leaseId, hash, bundleHash: it.bundleHash, files, summary: it.summary, usage: it.usage, result: it.result, runtime: it.runtime }, 30_000, `${it.id}-${hash.slice(0, 12)}-${it.attempts}`);
            if (a.ok) {
              this.outbox.remove(it.id);
              this.status.completed++;
              this.emit("submitted", { leaseId: it.leaseId, hash, duplicate: (a.data as any)?.duplicate ?? false });
            } else if (PERMANENT.has(a.error ?? "")) this.drop_(it, `${a.error}: ${a.detail ?? ""}`);
            else throw new Error(`${a.error}: ${a.detail}`);
          } catch (e) {
            this.status.lastError = (e as Error).message;
            if (this.ws?.readyState !== WebSocket.OPEN) break;
          }
        }
      } while (this.again && this.ws?.readyState === WebSocket.OPEN);
    } finally {
      this.flushing = false;
      this.status.outbox = this.outbox.size;
    }
  }

  private drop_(it: OutboxItem, why: string) {
    this.outbox.remove(it.id);
    this.log(`dropped result for lease ${it.leaseId.slice(0, 8)}: ${why}`);
    this.emit("dropped", { leaseId: it.leaseId, why });
  }

  private async getBytes(p: string): Promise<Buffer> {
    const r = await this.http(`${this.o.server}${p}`);
    if (!r.ok) throw new Error(`GET ${p}: ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }

  async postSigned(p: string, kind: string, payload: Record<string, unknown>): Promise<{ ok: boolean; status: number; text: string }> {
    const env = makeSignedEnvelope(this.o.key, kind, payload);
    const r = await this.http(`${this.o.server}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(env) });
    return { ok: r.ok, status: r.status, text: await r.text() };
  }

  /** Raw-body artifact upload (large media) with header-carried signature. */
  async uploadArtifact(leaseId: string, data: Buffer, mediaType: string, name: string) {
    const payload = { leaseId, sha256: sha256Hex(data), bytes: data.length, mediaType, name, nonce: randomHex(32), expiresAt: Math.floor(Date.now() / 1000) + 300 };
    const sig = signEnvelope(this.o.key.privateKeyPem, "artifact.upload", payload);
    const r = await this.http(`${this.o.server}/artifacts`, { method: "POST", headers: { "content-type": mediaType, [DEVICE_HEADERS.device]: this.o.key.deviceKey, [DEVICE_HEADERS.payload]: Buffer.from(canonicalJson(payload)).toString("base64"), [DEVICE_HEADERS.signature]: sig }, body: new Uint8Array(data) });
    return r.json();
  }
}
