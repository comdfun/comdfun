// @ts-check
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");

/**
 * Resolve a sibling workspace package to its TS/JS entry if it exists on disk; otherwise to a local fallback.
 * The contracts builder (@company/abi) and art builder (@company/art) work in parallel, so the web must build
 * with or without them. Set COMPANY_ABI=fallback / COMPANY_ART=fallback to force the fallbacks.
 */
function resolveWorkspace(dir, fallback, force) {
  const fb = path.join(here, fallback);
  if (force === "fallback") return fb;
  const pkgFile = path.join(repo, dir, "package.json");
  if (!fs.existsSync(pkgFile)) return fb;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
    const exp = pkg.exports && (typeof pkg.exports === "string" ? pkg.exports : pkg.exports["."]);
    const pick = (e) => (typeof e === "string" ? e : e && (e.import || e.default || e.types));
    const candidates = [pick(exp), pkg.module, pkg.main, "src/index.ts", "index.ts", "dist/index.js"].filter(Boolean);
    for (const c of candidates) {
      const abs = path.join(repo, dir, c);
      if (fs.existsSync(abs)) return abs;
    }
  } catch {}
  return fb;
}

const abiEntry = resolveWorkspace("packages/abi", "lib/abi-fallback.ts", process.env.COMPANY_ABI);
const artEntry = resolveWorkspace("packages/art", "lib/icons-fallback.ts", process.env.COMPANY_ART);
console.log(`[web] @company/abi -> ${path.relative(repo, abiEntry)}`);
console.log(`[web] @company/art -> ${path.relative(repo, artEntry)}`);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // NEXT_DIST_DIR lets e2e/ui.ts build a live-mode copy next to the normal one
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  outputFileTracingRoot: repo,
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: { externalDir: true },
  async redirects() {
    return [
      { source: "/trust", destination: "/swap", permanent: true },
      { source: "/trust/swap", destination: "/swap", permanent: true },
      { source: "/trust/stake", destination: "/stake", permanent: true },
      { source: "/trust/bond", destination: "/bond", permanent: true },
      { source: "/trust/docs", destination: "/docs/comd", permanent: true },
    ];
  },
  env: {
    NEXT_PUBLIC_ABI_SOURCE: abiEntry.includes("abi-fallback") ? "fallback" : "@company/abi",
    NEXT_PUBLIC_ART_SOURCE: artEntry.includes("icons-fallback") ? "fallback" : "@company/art",
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@company/abi$": abiEntry,
      "@company/art$": artEntry,
      // optional peers of the Base Account / CDP SDK pulled in by the wagmi connectors barrel; never used here
      "@x402/core/client": false,
      "@x402/evm": false,
      "@x402/evm/exact/client": false,
      "@x402/evm/upto/client": false,
      "@x402/svm/exact/client": false,
    };
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] };
    // optional peer deps of wallet SDKs that are not needed in the browser bundle
    config.externals = [...(config.externals || []), "pino-pretty", "lokijs", "encoding"];
    return config;
  },
};

export default nextConfig;
