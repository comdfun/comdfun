#!/usr/bin/env node
// Image-build helper: make TypeScript-source workspace packages loadable by plain `node` (native type stripping).
//
// Packages such as @company/abi export `src/index.ts` and import siblings as `./x.js` (bundler/tsx style). Node's
// type stripping loads the .ts entry but then looks for a real `./x.js` and fails. For every package dir given, this
// transpiles each `src/**/*.ts` that is imported through a `.js` specifier into a sibling `.js` (esbuild, ESM, no
// bundling), so both specifiers resolve. Source files are never modified; only missing .js files are written.
//
//   node infra/docker/emit-js.mjs packages/abi [packages/other ...]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { transformSync } from "esbuild";
import { writeFileSync } from "node:fs";

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? (n === "node_modules" ? [] : walk(p)) : [p];
});

let written = 0;
for (const pkg of process.argv.slice(2)) {
  const src = resolve(pkg, "src");
  if (!existsSync(src)) { console.log(`[emit-js] ${pkg}: no src/, skipped`); continue; }
  const files = walk(src).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));
  const wanted = new Set();
  for (const f of files) {
    for (const m of readFileSync(f, "utf8").matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)\.js["']/g)) {
      const ts = resolve(dirname(f), `${m[1]}.ts`);
      if (existsSync(ts)) wanted.add(ts);
    }
  }
  for (const ts of wanted) {
    const js = ts.replace(/\.ts$/, ".js");
    if (existsSync(js)) continue;
    const out = transformSync(readFileSync(ts, "utf8"), { loader: "ts", format: "esm", target: "node22", sourcefile: ts });
    writeFileSync(js, out.code);
    written++;
  }
  console.log(`[emit-js] ${pkg}: ${wanted.size} module(s) imported via .js specifiers`);
}
console.log(`[emit-js] wrote ${written} file(s)`);
