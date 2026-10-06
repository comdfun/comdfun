/** Runs only with TEST_DATABASE_URL (a disposable database): migrations, write-through, reload after restart. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PgStore } from "../src/store.ts";
import { App } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { MemoryBlobStore } from "../src/storage.ts";
import { MockChain } from "../src/chain.ts";

const url = process.env.TEST_DATABASE_URL;

test("PgStore: migrations apply once, records write through and reload in a new process", { skip: !url && "set TEST_DATABASE_URL to run" }, async () => {
  const pg = (await import("pg")).default;
  const admin = new pg.Pool({ connectionString: url });
  for (const t of (await admin.query("select tablename from pg_tables where schemaname = 'public'")).rows) await admin.query(`drop table if exists "${t.tablename}" cascade`);
  await admin.end();

  const cfg = loadConfig({ DATABASE_URL: url!, CHAIN_ID: "46630" });
  const a = await App.create({ cfg, store: new PgStore(url!), blobs: new MemoryBlobStore(), chain: new MockChain(), timers: false });
  const job = a.engine.admitJob({ objective: "Persist me.", skill: "write-readme-and-docs", paths: ["README.md"] }, { paidBy: null });
  a.event("test.event", { n: 1 });
  await a.store.flush();
  assert.equal(await a.store.healthy(), true);
  await a.close();

  const b = await App.create({ cfg, store: new PgStore(url!), blobs: new MemoryBlobStore(), chain: new MockChain(), timers: false });
  try {
    const again = b.store.c<any>("jobs").get(job.id);
    assert.equal(again.objective, "Persist me.");
    assert.equal(again.nodes[0].state, "ready");
    assert.equal(b.store.c<any>("policies").count(), 8, "policies seeded once, not duplicated");
    const p = new pg.Pool({ connectionString: url });
    const mig = await p.query("select name from schema_migrations");
    assert.deepEqual(mig.rows.map((r: any) => r.name), ["001_init.sql"]);
    const row = await p.query("select data->>'state' as state from jobs where id = $1", [job.id]);
    assert.equal(row.rows[0].state, "executing");
    await p.end();
    const h = await (await import("../src/routes.ts")).health(b);
    assert.equal(h.database.driver, "postgres");
    assert.equal(h.database.ok, true);
  } finally {
    await b.close();
  }
});
