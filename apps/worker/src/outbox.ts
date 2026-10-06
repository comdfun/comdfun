/**
 * Durable outbox (~/.comd/outbox/): a finished task is written here before anything is sent and removed only
 * when Chambers acknowledges it (or refuses it for good). After a reconnect the daemon replays it; the server
 * de-duplicates on (leaseId, hash), so replays are safe. Results are public anyway (the work is published).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SubmissionResult, Usage, RuntimeInfo } from "@company/protocol";

export interface OutboxFile { path: string; mediaType: string; data: string /* base64 */; sha256: string; bytes: number }

export interface OutboxItem {
  id: string;
  leaseId: string;
  jobId: string;
  nodeKey: string;
  files: OutboxFile[];
  result: SubmissionResult | null;
  summary: string;
  usage: Usage;
  runtime: RuntimeInfo;
  bundleHash: string | null;
  bundleFiles: { path: string; sha256: string; bytes: number; mediaType: string }[] | null;
  createdAt: number;
  attempts: number;
}

export class Outbox {
  private readonly dir: string;
  constructor(home: string) {
    this.dir = join(home, "outbox");
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }
  private file(id: string) {
    return join(this.dir, `${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  }
  put(item: OutboxItem) {
    const f = this.file(item.id);
    writeFileSync(`${f}.tmp`, JSON.stringify(item), { mode: 0o600 });
    renameSync(`${f}.tmp`, f);
  }
  remove(id: string) {
    rmSync(this.file(id), { force: true });
  }
  list(): OutboxItem[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => { try { return JSON.parse(readFileSync(join(this.dir, f), "utf8")) as OutboxItem; } catch { return null; } })
      .filter((x): x is OutboxItem => !!x)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  has(leaseId: string): boolean {
    return this.list().some((i) => i.leaseId === leaseId);
  }
  get size() {
    return this.list().length;
  }
}
