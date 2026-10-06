/** Applies migrations/*.sql in order, once each, recorded in schema_migrations. */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/ and dist/ both sit next to migrations/
  return join(here, "..", "migrations");
}

export async function migrate(pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }) {
  await pool.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await pool.query("select name from schema_migrations")).rows.map((r) => r.name));
  const files = readdirSync(migrationsDir()).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(migrationsDir(), f), "utf8");
    await pool.query("begin");
    try {
      await pool.query(sql);
      await pool.query("insert into schema_migrations (name) values ($1)", [f]);
      await pool.query("commit");
      console.log(`[migrate] applied ${f}`);
    } catch (e) {
      await pool.query("rollback");
      throw e;
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: url });
  await migrate(pool);
  await pool.end();
}
