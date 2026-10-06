#!/usr/bin/env bash
# Build the `comd` worker CLI release assets exactly as apps/worker/src/updater.ts expects them:
#   <out>/comd-worker.tgz      npm tarball (package.json comdWorker.asset)
#   <out>/SHA256SUMS           sha256sum format: "<hex>  comd-worker.tgz"
#
# The tarball is self-contained: dist/cli.js is the esbuild bundle (with @company/protocol inlined) and viem + ws
# are bundleDependencies, so `npm install --offline <tgz>` (the updater's probe install) works with an empty cache
# and the workspace-only @company/protocol never has to be resolved from a registry.
#
#   scripts/pack-worker.sh [out-dir]          # default: dist/worker-release
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$(mkdir -p "${1:-$ROOT/dist/worker-release}" && cd "${1:-$ROOT/dist/worker-release}" && pwd)"
WORKER="$ROOT/apps/worker"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

ASSET="$(node -p "const p=require('$WORKER/package.json'); (p.comdWorker ?? p.companyWorker)?.asset ?? 'comd-worker.tgz'")"
BIN="$(node -p "Object.keys(require('$WORKER/package.json').bin ?? { comd: '' })[0]")"
VERSION="$(node -p "require('$WORKER/package.json').version")"

echo "[pack-worker] building @company/worker $VERSION"
npm run build -w @company/worker >/dev/null
test -f "$WORKER/dist/cli.js"

cp -R "$WORKER/bin" "$WORKER/dist" "$STAGE/"
[ -f "$WORKER/README.md" ] && cp "$WORKER/README.md" "$STAGE/"
[ -f "$ROOT/LICENSE" ] && cp "$ROOT/LICENSE" "$STAGE/"

# Release manifest: no workspace deps, no dev deps, no source exports; runtime deps bundled.
node - "$WORKER/package.json" "$STAGE/package.json" <<'EOF'
const fs = require("node:fs");
const [src, dst] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(src, "utf8"));
const deps = { ...(pkg.dependencies ?? {}) };
for (const name of Object.keys(deps)) if (name.startsWith("@company/")) delete deps[name]; // inlined by esbuild
const out = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  type: pkg.type,
  license: pkg.license ?? "MIT",
  engines: pkg.engines,
  bin: pkg.bin,
  exports: { "./package.json": "./package.json" },
  comdWorker: pkg.comdWorker ?? pkg.companyWorker,
  files: ["bin", "dist", "README.md", "LICENSE"],
  dependencies: deps,
  bundleDependencies: Object.keys(deps),
};
fs.writeFileSync(dst, JSON.stringify(out, null, 2) + "\n");
EOF

echo "[pack-worker] installing bundled runtime deps: $(node -p "Object.keys(require('$STAGE/package.json').dependencies).join(', ')")"
(cd "$STAGE" && npm install --omit=dev --ignore-scripts --no-audit --no-fund --no-package-lock >/dev/null)

(cd "$STAGE" && npm pack --silent --pack-destination "$STAGE" >/dev/null)
packed="$(ls "$STAGE"/*.tgz | head -n1)"
mv "$packed" "$OUT/$ASSET"
(cd "$OUT" && sha256sum "$ASSET" > SHA256SUMS)

# Smoke test the way the updater does it: checksum, offline install into a scratch prefix, run the CLI.
probe="$(mktemp -d)"
(cd "$OUT" && sha256sum -c SHA256SUMS >/dev/null)
npm install --prefix "$probe" --offline --no-audit --no-fund "$OUT/$ASSET" >/dev/null
"$probe/node_modules/.bin/$BIN" help >/dev/null
rm -rf "$probe"

echo "[pack-worker] $OUT/$ASSET ($(du -h "$OUT/$ASSET" | cut -f1)), version $VERSION"
cat "$OUT/SHA256SUMS"
