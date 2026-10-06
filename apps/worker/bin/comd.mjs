#!/usr/bin/env node
// Launcher: the release tarball ships dist/cli.js (bundled); a source checkout runs src/cli.ts through tsx.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(`comd needs Node.js 22 or newer (found ${process.versions.node}).`);
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist", "cli.js");
if (existsSync(dist)) {
  const { main } = await import(pathToFileURL(dist).href);
  const code = await main(process.argv.slice(2)).catch((e) => { console.error(`comd: ${e.message}`); return 1; });
  if (code) process.exit(code);
} else {
  const r = spawnSync(process.execPath, ["--import", "tsx", join(here, "..", "src", "cli.ts"), ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, COMD_CLI_ENTRY: "1" } });
  process.exit(r.status ?? 1);
}
