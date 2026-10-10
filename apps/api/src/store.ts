/**
 * Repository layer. The control plane keeps its working set in memory (one process owns dispatch), and a
 * Store implementation decides durability:
 *
 *   MemoryStore  tests, demos, `npm test` without Postgres
 *   PgStore      DATABASE_URL set: loads every collection at boot, writes each change through to Postgres
 *                (one table per collection, `data jsonb`, see migrations/), serialised per row
 *
 * Callers mutate records and call `save(record)`; reads never touch the database.
 */
export interface Rec { id: string; createdAt: string; updatedAt?: string }

export class Collection<T extends Rec> {
  readonly name: string;
  private readonly map = new Map<string, T>();
  onSave?: (name: string, rec: T) => void;
  onDelete?: (name: string, id: string) => void;
  constructor(name: string) {
    this.name = name;
  }

  get(id: string): T | undefined {
    return this.map.get(id);
  }
  has(id: string): boolean {
    return this.map.has(id);
  }
  /** Insert or replace, then persist. */
  save(rec: T): T {
    this.map.set(rec.id, rec);
    this.onSave?.(this.name, rec);
    return rec;
  }
  /** Load without persisting (boot). */
  load(rec: T) {
    this.map.set(rec.id, rec);
  }
  delete(id: string) {
    if (this.map.delete(id)) this.onDelete?.(this.name, id);
  }
  all(): T[] {
    return [...this.map.values()];
  }
  filter(pred: (r: T) => boolean): T[] {
    const out: T[] = [];
    for (const r of this.map.values()) if (pred(r)) out.push(r);
    return out;
  }
  find(pred: (r: T) => boolean): T | undefined {
    for (const r of this.map.values()) if (pred(r)) return r;
    return undefined;
  }
  count(pred?: (r: T) => boolean): number {
    if (!pred) return this.map.size;
    let n = 0;
    for (const r of this.map.values()) if (pred(r)) n++;
    return n;
  }
  /** Newest first by createdAt, optionally strictly before a cursor (ms), limited. */
  newest(opts: { before?: number | null; limit?: number; filter?: (r: T) => boolean } = {}): T[] {
    let rows = this.all();
    if (opts.filter) rows = rows.filter(opts.filter);
    if (opts.before != null) rows = rows.filter((r) => Date.parse(r.createdAt) < opts.before!);
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }
}

export const COLLECTIONS = [
  "jobs", "submissions", "attempts", "orders", "oracle", "schedules", "runs", "workflows", "launches", "policies",
  "assurances", "sites", "enrollments", "pairings", "seats", "feedback", "documents", "bundles", "artifacts", "fuzz",
  "epochs", "events", "kv", "nonces",
  "room_sessions", "room_messages", "room_promos", "room_bans", "trials",
] as const;
export type CollectionName = (typeof COLLECTIONS)[number];

export interface Store {
  readonly driver: "memory" | "postgres";
  c<T extends Rec>(name: CollectionName): Collection<T>;
  init(): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
  healthy(): Promise<boolean>;
}

export class MemoryStore implements Store {
  readonly driver: "memory" | "postgres" = "memory";
  protected readonly cols = new Map<string, Collection<any>>();
  constructor() {
    for (const n of COLLECTIONS) this.cols.set(n, new Collection(n));
  }
  c<T extends Rec>(name: CollectionName): Collection<T> {
    return this.cols.get(name)!;
  }
  async init() {}
  async flush() {}
  async close() {}
  async healthy() { return true; }
}

/** Write-through Postgres persistence using `pg` (lazy-imported so tests never need it). */
export class PgStore extends MemoryStore {
  override readonly driver = "postgres" as const;
  private pool: any;
  private chain: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private lastError: string | null = null;
  private readonly url: string;
  constructor(url: string) {
    super();
    this.url = url;
  }

  override async init() {
    const pg = (await import("pg")).default;
    this.pool = new pg.Pool({ connectionString: this.url, max: 5, ssl: /sslmode=require|railway|\.proxy\./.test(this.url) ? { rejectUnauthorized: false } : undefined });
    const { migrate } = await import("./migrate.ts");
    await migrate(this.pool);
    for (const name of COLLECTIONS) {
      const { rows } = await this.pool.query(`select data from ${name}`);
      const col = this.c(name);
      for (const r of rows) col.load(r.data);
      col.onSave = (n, rec) => this.enqueue(`insert into ${n} (id, created_at, updated_at, data) values ($1, $2, now(), $3) on conflict (id) do update set data = excluded.data, updated_at = now()`, [rec.id, rec.createdAt, JSON.stringify(rec)]);
      col.onDelete = (n, id) => this.enqueue(`delete from ${n} where id = $1`, [id]);
    }
  }

  private enqueue(sql: string, params: unknown[]) {
    this.pending++;
    this.chain = this.chain
      .then(() => this.pool.query(sql, params))
      .then(() => { this.lastError = null; })
      .catch((e: Error) => { this.lastError = e.message; console.error(`[store] write failed: ${e.message}`); })
      .finally(() => { this.pending--; });
  }

  override async flush() {
    await this.chain;
  }
  override async close() {
    await this.flush();
    await this.pool?.end();
  }
  override async healthy() {
    try {
      await this.pool.query("select 1");
      return this.lastError === null;
    } catch {
      return false;
    }
  }
}

export function createStore(databaseUrl: string | null): Store {
  return databaseUrl ? new PgStore(databaseUrl) : new MemoryStore();
}

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export interface KvLike {
  get(key: string): any;
  set(key: string, value: unknown): void;
}
