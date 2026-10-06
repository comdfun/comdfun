/**
 * Updates from GitHub Releases only (never the npm registry): fetch the latest release of the worker repository
 * (COMD_WORKER_REPO, or package.json comdWorker.releasesRepo, default comd-fun/worker), download the
 * tarball and SHA256SUMS, verify the checksum, test the install offline into a scratch prefix, then install globally.
 * With --auto-update the daemon checks at start and every five minutes and drains running work before restarting.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CHECK_INTERVAL_MS = 5 * 60_000;

export function packageInfo(): { version: string; repo: string; asset: string } {
  const here = dirname(fileURLToPath(import.meta.url));
  let pkg: any = {};
  for (const p of [join(here, "..", "package.json"), join(here, "..", "..", "package.json")]) {
    try { pkg = JSON.parse(readFileSync(p, "utf8")); if (pkg.name === "@company/worker") break; } catch { /* try next */ }
  }
  return { version: pkg.version ?? "0.0.0", repo: process.env.COMD_WORKER_REPO ?? (pkg.comdWorker ?? pkg.companyWorker)?.releasesRepo ?? "comd-fun/worker", asset: (pkg.comdWorker ?? pkg.companyWorker)?.asset ?? "comd-worker.tgz" };
}

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = b.replace(/^v/, "").split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x < y ? -1 : 1;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

/** Parse `sha256sum` output ("<hex>  <name>" or "<hex> *<name>") and check `data` against `name`. */
export function verifyChecksum(data: Buffer, sums: string, name: string): boolean {
  const want = sums.split(/\r?\n/).map((l) => /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(l.trim())).find((m) => m && m[2].trim() === name)?.[1]?.toLowerCase();
  if (!want) return false;
  return createHash("sha256").update(data).digest("hex") === want;
}

export interface Release { version: string; tarballUrl: string; sumsUrl: string }

export async function latestRelease(repo: string, asset: string, f: typeof fetch = fetch): Promise<Release | null> {
  const r = await f(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { accept: "application/vnd.github+json", "user-agent": "comd-worker" } });
  if (!r.ok) return null;
  const j: any = await r.json();
  const tgz = j.assets?.find((a: any) => a.name === asset);
  const sums = j.assets?.find((a: any) => a.name === "SHA256SUMS");
  if (!tgz || !sums) return null;
  return { version: String(j.tag_name).replace(/^v/, ""), tarballUrl: tgz.browser_download_url, sumsUrl: sums.browser_download_url };
}

export async function checkForUpdate(f: typeof fetch = fetch): Promise<Release | null> {
  const info = packageInfo();
  const rel = await latestRelease(info.repo, info.asset, f).catch(() => null);
  return rel && compareVersions(rel.version, info.version) > 0 ? rel : null;
}

export async function applyUpdate(rel: Release, f: typeof fetch = fetch, log: (m: string) => void = console.log): Promise<void> {
  const info = packageInfo();
  const dir = mkdtempSync(join(tmpdir(), "comd-update-"));
  try {
    const [tgz, sums] = await Promise.all([f(rel.tarballUrl).then((r) => r.arrayBuffer()), f(rel.sumsUrl).then((r) => r.text())]);
    const data = Buffer.from(tgz);
    if (!verifyChecksum(data, sums, info.asset)) throw new Error("SHA256SUMS does not match the downloaded tarball; refusing to install");
    const file = join(dir, info.asset);
    writeFileSync(file, data);
    log(`verified ${info.asset} ${rel.version}; testing the install offline`);
    execFileSync("npm", ["install", "--prefix", join(dir, "probe"), "--offline", "--no-audit", "--no-fund", file], { stdio: "pipe" });
    execFileSync("npm", ["install", "--global", "--no-audit", "--no-fund", file], { stdio: "inherit" });
    log(`updated to ${rel.version}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
