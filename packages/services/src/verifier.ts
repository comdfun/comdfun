/**
 * The Clerk (verifier): structural verification of a seat's submission.
 *
 * verifySubmission diffs the workspace against its base, enforces the write budget, checks the
 * declared outputs (media types sniffed from bytes), and runs the skill's structural checks
 * (Foundry build/test, web build, research citations, media magic bytes, JSON report schemas)
 * in a throwaway copy with a stripped environment, wall-clock timeouts and no network unless the
 * skill requires it.
 */
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { validateLaunchManifest } from "./deployer.ts";
import { mediaFamily, mediaTypeCompatible, sniffMediaType, type MediaFamily } from "./media.ts";
import { findBinary, makeSandboxCopy, runSandboxed, type RunResult } from "./sandbox.ts";
import { siteContentCheck } from "./sites.ts";
import { getSkill, type CheckId, type DeclaredOutput, type SkillMeta } from "./skills.ts";
import { DEFAULT_IGNORES, hashTree, normalizeRelPath, pathAllowed, walkFiles } from "./util.ts";

export type CheckStatus = "pass" | "fail" | "skip" | "error";

export interface CheckResult {
  id: string;
  status: CheckStatus;
  detail: string;
}

export interface Finding {
  check: string;
  severity: "error" | "warning";
  message: string;
  path?: string;
}

export interface VerifyInput {
  workspaceDir: string;
  /** the tree the seat started from; omitted = every file counts as added */
  baseDir?: string;
  /** write budget; empty/undefined = whatever the skill's `writes` allows */
  allowedPaths?: string[];
  /** skill id (looked up in skills/index.json) or full metadata */
  skill: string | SkillMeta;
  /** declared outputs from the job/step (merged with the skill's own required outputs) */
  outputs?: DeclaredOutput[];
  /** overall budget for all commands (default 10 min); each command gets what is left */
  timeoutMs?: number;
  /** research: minimum distinct cited URLs (default 1) */
  minCitations?: number;
  /** research: phrases the report must contain (job rubric.contains) */
  rubricContains?: string[];
  forgeBin?: string;
  npmBin?: string;
  /** minimum passing Foundry tests when foundry-test runs (default 1) */
  minTests?: number;
  /** directory of skills/ (default: repo skills/ or SKILLS_DIR) */
  skillsDir?: string;
  /** CPU-seconds per command (ulimit -t); default none */
  cpuSeconds?: number;
}

export interface VerifyResult {
  ok: boolean;
  skill: string;
  checks: CheckResult[];
  findings: Finding[];
  changed: { added: string[]; modified: string[]; deleted: string[] };
  durationMs: number;
}

const MAX_RUNTIME_SIZE = 24_576;
const MAX_INITCODE_SIZE = 49_152;

class Ctx {
  readonly checks: CheckResult[] = [];
  readonly findings: Finding[] = [];
  readonly deadline: number;
  sandboxDir: string | null = null;
  private cleanupFn: (() => Promise<void>) | null = null;
  forgeBuilt: RunResult | null = null;
  webBuilt: { ok: boolean; distDir: string | null; detail: string } | null = null;
  readonly input: VerifyInput;
  readonly skill: SkillMeta;
  readonly changed: VerifyResult["changed"];
  constructor(input: VerifyInput, skill: SkillMeta, changed: VerifyResult["changed"]) {
    this.input = input;
    this.skill = skill;
    this.changed = changed;
    this.deadline = Date.now() + (input.timeoutMs ?? 600_000);
  }
  get network(): boolean {
    return this.skill.requires.includes("network");
  }
  remaining(): number {
    return Math.max(1_000, this.deadline - Date.now());
  }
  add(id: string, status: CheckStatus, detail: string): void {
    this.checks.push({ id, status, detail });
    if (status === "fail" || status === "error") this.findings.push({ check: id, severity: "error", message: detail });
  }
  finding(check: string, message: string, p?: string, severity: Finding["severity"] = "error"): void {
    this.findings.push({ check, severity, message, path: p });
  }
  ws(p = ""): string {
    return path.join(this.input.workspaceDir, p);
  }
  async sandbox(): Promise<string> {
    if (!this.sandboxDir) {
      const s = await makeSandboxCopy(this.input.workspaceDir);
      this.sandboxDir = s.dir;
      this.cleanupFn = s.cleanup;
    }
    return this.sandboxDir;
  }
  async cleanup(): Promise<void> {
    if (this.cleanupFn) await this.cleanupFn();
  }
  run(cmd: string, args: string[], extraEnv: Record<string, string> = {}): Promise<RunResult> {
    return runSandboxed(cmd, args, { cwd: this.sandboxDir!, timeoutMs: this.remaining(), network: this.network, env: extraEnv, cpuSeconds: this.input.cpuSeconds });
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(p: string): Promise<any> {
  return JSON.parse(await readFile(p, "utf8"));
}

function tail(s: string, n = 1500): string {
  const t = s.trim();
  return t.length > n ? `…${t.slice(t.length - n)}` : t;
}

/* ------------------------------------------------------------------------------------------- */

async function diffTrees(workspaceDir: string, baseDir?: string): Promise<VerifyResult["changed"]> {
  // .company/ holds pinned reads handed to the seat; dist/ and broadcast/ are rebuilt, never trusted
  const ignore = [...DEFAULT_IGNORES, "dist", "broadcast", ".company"];
  const head = await hashTree(workspaceDir, ignore);
  const base = baseDir ? await hashTree(baseDir, ignore) : new Map<string, string>();
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  for (const [p, h] of head) {
    const b = base.get(p);
    if (b === undefined) added.push(p);
    else if (b !== h) modified.push(p);
  }
  for (const p of base.keys()) if (!head.has(p)) deleted.push(p);
  return { added, modified, deleted };
}

function checkPaths(ctx: Ctx, mode: "paths" | "no-writes"): void {
  const { added, modified, deleted } = ctx.changed;
  const all = [...added, ...modified, ...deleted];
  let allowed: string[];
  if (mode === "no-writes") allowed = ["artifacts/"];
  else {
    const declared = ctx.input.allowedPaths ?? [];
    if (declared.length === 0) {
      if (ctx.skill.writes === "paths") {
        ctx.add("paths", "fail", `skill ${ctx.skill.id} requires the step to declare paths, and none were given`);
        return;
      }
      allowed = ctx.skill.writes === "none" ? ["artifacts/"] : ["**"];
    } else allowed = [...declared, "artifacts/"];
  }
  const outputPaths = new Set(allOutputs(ctx).map((o) => o.path));
  const violations = all.filter((p) => !pathAllowed(p, allowed) && !outputPaths.has(p));
  for (const v of violations) ctx.finding(mode, `changed outside the allowed paths: ${v}`, v);
  if (violations.length) ctx.add(mode, "fail", `${violations.length} path(s) changed outside [${allowed.join(", ")}]: ${violations.slice(0, 10).join(", ")}`);
  else ctx.add(mode, "pass", `${all.length} change(s) (+${added.length} ~${modified.length} -${deleted.length}) within [${allowed.join(", ")}]`);
}

async function checkSymlinks(ctx: Ctx): Promise<void> {
  const files = await walkFiles(ctx.ws());
  const links = files.filter((f) => f.type === "symlink");
  if (links.length) {
    for (const l of links) ctx.finding("symlinks", "symlinks are not accepted in submissions", l.path);
    ctx.add("symlinks", "fail", `${links.length} symlink(s): ${links.map((l) => l.path).slice(0, 10).join(", ")}`);
  }
}

function allOutputs(ctx: Ctx): DeclaredOutput[] {
  const seen = new Map<string, DeclaredOutput>();
  for (const o of ctx.skill.outputs ?? []) seen.set(o.path, o);
  for (const o of ctx.input.outputs ?? []) seen.set(o.path, { ...o, required: true });
  return [...seen.values()];
}

async function checkOutputs(ctx: Ctx): Promise<void> {
  const outs = allOutputs(ctx);
  if (outs.length === 0) {
    ctx.add("outputs", "skip", "no declared outputs");
    return;
  }
  let bad = 0;
  const lines: string[] = [];
  for (const o of outs) {
    let rel: string;
    try {
      rel = normalizeRelPath(o.path);
    } catch (e: any) {
      bad++;
      ctx.finding("outputs", e.message, o.path);
      continue;
    }
    if (ctx.input.outputs?.some((x) => x.path === o.path) && !rel.startsWith("artifacts/")) {
      bad++;
      ctx.finding("outputs", `declared output must live under artifacts/: ${rel}`, rel);
      continue;
    }
    const abs = ctx.ws(rel);
    let st;
    try {
      st = await stat(abs);
    } catch {
      if (o.required === false) {
        lines.push(`${rel}: absent (optional)`);
        continue;
      }
      bad++;
      ctx.finding("outputs", `declared output missing: ${rel}`, rel);
      continue;
    }
    if (!st.isFile() || st.size === 0) {
      bad++;
      ctx.finding("outputs", `declared output is empty or not a file: ${rel}`, rel);
      continue;
    }
    const head = await readFile(abs);
    const sniffed = sniffMediaType(head);
    if (!mediaTypeCompatible(o.mediaType, sniffed)) {
      bad++;
      ctx.finding("outputs", `${rel} declared ${o.mediaType} but its bytes look like ${sniffed ?? "unknown binary"}`, rel);
      continue;
    }
    lines.push(`${rel}: ${sniffed} (${st.size} B)`);
  }
  ctx.add("outputs", bad ? "fail" : "pass", bad ? `${bad} output problem(s)` : lines.join("; "));
}

/* --------------------------------------- Foundry ------------------------------------------- */

async function forgeBinary(ctx: Ctx): Promise<string | null> {
  return findBinary("forge", { explicit: ctx.input.forgeBin, envVar: "FORGE_BIN" });
}

async function foundryBuild(ctx: Ctx, id: string): Promise<boolean> {
  if (ctx.forgeBuilt) return ctx.forgeBuilt.code === 0;
  if (!(await exists(ctx.ws("foundry.toml")))) {
    ctx.add(id, "fail", "no foundry.toml at the project root");
    return false;
  }
  const forge = await forgeBinary(ctx);
  if (!forge) {
    ctx.add(id, "error", "forge not available on this Clerk (set FORGE_BIN); cannot verify");
    return false;
  }
  await ctx.sandbox();
  // note: `forge build --json` exits 0 even on compile errors, so the gate is a plain build
  const args = ["build"];
  if (!ctx.network) args.push("--offline");
  const r = await ctx.run(forge, args);
  ctx.forgeBuilt = r;
  return r.code === 0;
}

async function checkFoundryBuild(ctx: Ctx): Promise<void> {
  const ok = await foundryBuild(ctx, "foundry-build");
  if (ctx.checks.some((c) => c.id === "foundry-build")) return;
  const r = ctx.forgeBuilt!;
  if (ok) ctx.add("foundry-build", "pass", `forge build ok in ${r.durationMs} ms (network: ${r.network})`);
  else ctx.add("foundry-build", "fail", `forge build failed${r.timedOut ? " (timed out)" : ""}: ${tail(r.stderr || r.stdout)}`);
}

function parseForgeTestSummary(out: string): { passed: number; failed: number; skipped: number } | null {
  const m = /(\d+) tests? passed, (\d+) failed, (\d+) skipped/.exec(out);
  if (m) return { passed: +m[1], failed: +m[2], skipped: +m[3] };
  return null;
}

async function checkFoundryTest(ctx: Ctx): Promise<void> {
  if (!(await foundryBuild(ctx, "foundry-test"))) {
    if (!ctx.checks.some((c) => c.id === "foundry-test")) ctx.add("foundry-test", "skip", "build failed; tests not run");
    return;
  }
  const forge = (await forgeBinary(ctx))!;
  const args = ["test"];
  if (!ctx.network) args.push("--offline");
  const r = await ctx.run(forge, args);
  const out = `${r.stdout}\n${r.stderr}`;
  const sum = parseForgeTestSummary(out);
  const minTests = ctx.input.minTests ?? 1;
  if (r.timedOut) ctx.add("foundry-test", "fail", `forge test timed out after ${r.durationMs} ms`);
  else if (r.code !== 0 || (sum && sum.failed > 0)) {
    const failing = [...out.matchAll(/\[FAIL[^\]]*\]\s*([^\s(]+)/g)].map((m) => m[1]);
    for (const f of failing) ctx.finding("foundry-test", `failing test: ${f}`);
    ctx.add("foundry-test", "fail", `forge test failed${sum ? ` (${sum.passed} passed, ${sum.failed} failed)` : ""}: ${tail(out, 800)}`);
  } else if (!sum || sum.passed < minTests) ctx.add("foundry-test", "fail", `expected at least ${minTests} passing test(s), found ${sum?.passed ?? 0}`);
  else ctx.add("foundry-test", "pass", `${sum.passed} passed, ${sum.skipped} skipped in ${r.durationMs} ms`);
}

async function checkFoundrySizes(ctx: Ctx): Promise<void> {
  if (!(await foundryBuild(ctx, "foundry-sizes"))) {
    if (!ctx.checks.some((c) => c.id === "foundry-sizes")) ctx.add("foundry-sizes", "skip", "build failed");
    return;
  }
  const forge = (await forgeBinary(ctx))!;
  const r = await ctx.run(forge, ["build", "--sizes", "--json", ...(ctx.network ? [] : ["--offline"])]);
  let sizes: Record<string, { runtime_size: number; init_size: number }> | null = null;
  const lines = r.stdout.split("\n").filter((l) => l.trim().startsWith("{"));
  for (const l of lines.reverse()) {
    try {
      sizes = JSON.parse(l);
      break;
    } catch {
      /* next */
    }
  }
  if (!sizes || Object.keys(sizes).length === 0) {
    ctx.add("foundry-sizes", "error", `could not read contract sizes from forge build --sizes: ${tail(r.stderr || r.stdout, 500)}`);
    return;
  }
  const over = Object.entries(sizes).filter(([name, s]) => !/(Test|Script|Harness|Mock)$/.test(name) && (s.runtime_size > MAX_RUNTIME_SIZE || s.init_size > MAX_INITCODE_SIZE));
  for (const [name, s] of over) ctx.finding("foundry-sizes", `${name} runtime ${s.runtime_size} B / initcode ${s.init_size} B exceeds EIP-170/3860 limits`);
  ctx.add("foundry-sizes", over.length ? "fail" : "pass", over.length ? `${over.length} contract(s) too large to deploy` : `${Object.keys(sizes).length} contract(s) within size limits`);
}

async function checkFoundryScript(ctx: Ctx): Promise<void> {
  const scripts = (await walkFiles(ctx.ws("script"))).filter((f) => f.path.endsWith(".s.sol"));
  if (!scripts.length) {
    ctx.add("foundry-script", "fail", "no script/*.s.sol deployment script");
    return;
  }
  const missingEnv: string[] = [];
  for (const s of scripts) {
    const src = await readFile(s.abs, "utf8");
    if (/0x[0-9a-fA-F]{64}/.test(src)) ctx.finding("foundry-script", `script/${s.path} contains a 32-byte hex literal; keys must come from env`, `script/${s.path}`);
    if (!/vm\.env|vm\.readFile|vm\.parseJson|vm\.envOr/.test(src)) missingEnv.push(s.path);
  }
  if (missingEnv.length) ctx.finding("foundry-script", `script(s) take no configuration from env/files: ${missingEnv.join(", ")}`, undefined, "warning");
  const hardKey = ctx.findings.some((f) => f.check === "foundry-script" && f.severity === "error");
  ctx.add("foundry-script", hardKey ? "fail" : "pass", `${scripts.length} script(s)${hardKey ? "; hard-coded key material found" : ""}`);
}

/* ----------------------------------------- Web --------------------------------------------- */

async function webBuild(ctx: Ctx, id: string): Promise<{ ok: boolean; distDir: string | null; detail: string }> {
  if (ctx.webBuilt) return ctx.webBuilt;
  const done = (ok: boolean, distDir: string | null, detail: string) => (ctx.webBuilt = { ok, distDir, detail });
  const pkgPath = ctx.ws("package.json");
  if (!(await exists(pkgPath))) return done(false, null, "no package.json at the project root");
  let pkg: any;
  try {
    pkg = await readJson(pkgPath);
  } catch (e: any) {
    return done(false, null, `package.json is not valid JSON: ${e.message}`);
  }
  if (!pkg?.scripts?.build) return done(false, null, 'package.json has no "build" script');
  const npm = await findBinary("npm", { explicit: ctx.input.npmBin, envVar: "NPM_BIN" });
  if (!npm) return done(false, null, "npm not available on this Clerk");
  const dir = await ctx.sandbox();
  const hasLock = await exists(path.join(dir, "package-lock.json"));
  const install = await ctx.run(npm, hasLock ? ["ci", "--no-audit", "--no-fund"] : ["install", "--no-audit", "--no-fund"]);
  if (install.code !== 0) return done(false, null, `npm ${hasLock ? "ci" : "install"} failed${install.timedOut ? " (timed out)" : ""}: ${tail(install.stderr || install.stdout)}`);
  if (!hasLock) ctx.finding(id, "no package-lock.json; dependencies are not pinned", "package-lock.json", "warning");
  const build = await ctx.run(npm, ["run", "build"]);
  if (build.code !== 0) return done(false, null, `npm run build failed${build.timedOut ? " (timed out)" : ""}: ${tail(build.stderr || build.stdout)}`);
  const distDir = path.join(dir, "dist");
  if (!(await exists(path.join(distDir, "index.html")))) return done(false, null, "build did not produce dist/index.html");
  const files = await walkFiles(distDir);
  return done(true, distDir, `npm build ok; dist/ has ${files.length} file(s) (network: ${build.network})`);
}

async function checkWebBuild(ctx: Ctx): Promise<void> {
  const r = await webBuild(ctx, "web-build");
  ctx.add("web-build", r.ok ? "pass" : "fail", r.detail);
}

async function checkSiteScreen(ctx: Ctx): Promise<void> {
  let distDir: string | null = null;
  if (ctx.skill.checks.includes("web-build") || (await exists(ctx.ws("package.json")))) {
    const r = await webBuild(ctx, "site-screen");
    distDir = r.distDir;
  }
  if (!distDir) {
    for (const cand of ["dist", "site", "public"]) if (await exists(ctx.ws(`${cand}/index.html`))) distDir = ctx.ws(cand);
  }
  if (!distDir) {
    ctx.add("site-screen", "skip", "no built site to screen");
    return;
  }
  const screen = await siteContentCheck(distDir);
  for (const f of screen.findings) ctx.finding("site-screen", `${f.rule}: ${f.detail}`, f.file, f.severity === "block" ? "error" : "warning");
  ctx.add("site-screen", screen.verdict === "block" ? "fail" : "pass", `verdict ${screen.verdict}; ${screen.stats.files} file(s), ${screen.stats.totalBytes} B`);
}

async function checkNpm(ctx: Ctx): Promise<void> {
  const npm = await findBinary("npm", { explicit: ctx.input.npmBin, envVar: "NPM_BIN" });
  if (!(await exists(ctx.ws("package.json")))) return ctx.add("npm-check", "fail", "no package.json");
  if (!npm) return ctx.add("npm-check", "error", "npm not available");
  const dir = await ctx.sandbox();
  const hasLock = await exists(path.join(dir, "package-lock.json"));
  const steps: [string, string[]][] = [
    [hasLock ? "ci" : "install", [hasLock ? "ci" : "install", "--no-audit", "--no-fund"]],
    ["typecheck", ["run", "--if-present", "typecheck"]],
    ["test", ["run", "--if-present", "test"]],
  ];
  for (const [name, args] of steps) {
    const r = await ctx.run(npm, args);
    if (r.code !== 0) return ctx.add("npm-check", "fail", `npm ${name} failed: ${tail(r.stderr || r.stdout)}`);
  }
  ctx.add("npm-check", "pass", "install, typecheck and tests ok");
}

async function checkIndexer(ctx: Ctx): Promise<void> {
  const need = ["ponder.config.ts", "ponder.schema.ts", "package.json"];
  const missing: string[] = [];
  for (const n of need) if (!(await exists(ctx.ws(n)))) missing.push(n);
  const handlers = (await walkFiles(ctx.ws("src"))).filter((f) => /\.(ts|js)$/.test(f.path));
  if (!handlers.length) missing.push("src/*.ts handlers");
  if (!missing.length) {
    const pkg = await readJson(ctx.ws("package.json")).catch(() => ({}));
    if (!pkg?.dependencies?.ponder && !pkg?.devDependencies?.ponder) missing.push('"ponder" dependency');
  }
  ctx.add("indexer", missing.length ? "fail" : "pass", missing.length ? `missing: ${missing.join(", ")}` : `${handlers.length} handler file(s)`);
}

async function checkProjectBuild(ctx: Ctx): Promise<void> {
  const foundry = await exists(ctx.ws("foundry.toml"));
  const web = await exists(ctx.ws("package.json"));
  if (!foundry && !web) return ctx.add("project-build", "fail", "neither foundry.toml nor package.json at the project root");
  const parts: string[] = [];
  let ok = true;
  if (foundry) {
    await checkFoundryBuild(ctx);
    await checkFoundryTest(ctx);
    ok &&= ctx.checks.filter((c) => c.id.startsWith("foundry-")).every((c) => c.status === "pass");
    parts.push("foundry");
  }
  if (web) {
    const pkg = await readJson(ctx.ws("package.json")).catch(() => ({}));
    if (pkg?.scripts?.build) {
      const r = await webBuild(ctx, "project-build");
      ok &&= r.ok;
      parts.push(r.ok ? "web" : `web failed: ${r.detail}`);
    }
  }
  ctx.add("project-build", ok ? "pass" : "fail", `built: ${parts.join(", ")}`);
}

/* --------------------------------------- Content ------------------------------------------- */

async function findMarkdownReport(ctx: Ctx): Promise<string | null> {
  for (const o of allOutputs(ctx)) if (/\.md$/i.test(o.path) && (await exists(ctx.ws(o.path)))) return o.path;
  for (const c of ["artifacts/report.md", "REPORT.md", "report.md", "README.md"]) if (await exists(ctx.ws(c))) return c;
  return null;
}

export function extractCitations(markdown: string): string[] {
  const urls = new Set<string>();
  for (const m of markdown.matchAll(/\]\((https?:\/\/[^)\s]+)\)|<(https?:\/\/[^>\s]+)>|(?:^|[\s(])(https?:\/\/[^\s)<>\]]+)/gm)) {
    const u = (m[1] ?? m[2] ?? m[3]).replace(/[.,;:!?'"]+$/, "");
    try {
      const url = new URL(u);
      url.hash = "";
      urls.add(url.toString());
    } catch {
      /* not a URL */
    }
  }
  return [...urls];
}

async function checkResearch(ctx: Ctx): Promise<void> {
  const rel = await findMarkdownReport(ctx);
  if (!rel) return ctx.add("research-citations", "fail", "no markdown report (artifacts/report.md)");
  const text = await readFile(ctx.ws(rel), "utf8");
  const citations = extractCitations(text);
  const min = ctx.input.minCitations ?? 1;
  const problems: string[] = [];
  if (citations.length < min) problems.push(`${citations.length} distinct cited URL(s) < minCitations ${min}`);
  if (text.trim().length < 400) problems.push("report is shorter than 400 characters");
  if (!/^#{1,3} .*(uncertain|limitation|confidence|caveat)/im.test(text)) ctx.finding("research-citations", "no section on uncertainty or limitations", rel, "warning");
  for (const phrase of ctx.input.rubricContains ?? []) {
    if (!text.toLowerCase().includes(phrase.toLowerCase())) problems.push(`rubric phrase missing: "${phrase}"`);
  }
  for (const p of problems) ctx.finding("research-citations", p, rel);
  ctx.add("research-citations", problems.length ? "fail" : "pass", problems.length ? problems.join("; ") : `${rel}: ${citations.length} citation(s)`);
}

async function checkMedia(ctx: Ctx, family: MediaFamily): Promise<void> {
  const id = `media-${family}`;
  let candidates = allOutputs(ctx).map((o) => o.path);
  if (!candidates.length) candidates = (await walkFiles(ctx.ws("artifacts"))).map((f) => `artifacts/${f.path}`);
  const found: string[] = [];
  for (const rel of candidates) {
    const abs = ctx.ws(rel);
    if (!(await exists(abs))) continue;
    const buf = await readFile(abs);
    const sniffed = sniffMediaType(buf);
    if (mediaFamily(sniffed) === family) {
      if (buf.length < 64) ctx.finding(id, `${rel} is implausibly small (${buf.length} B)`, rel);
      else found.push(`${rel} (${sniffed}, ${buf.length} B)`);
    } else if (allOutputs(ctx).some((o) => o.path === rel && mediaFamily(o.mediaType) === family)) {
      ctx.finding(id, `${rel} is declared ${family} but its bytes are ${sniffed ?? "unrecognised"}`, rel);
    }
  }
  const bad = ctx.findings.some((f) => f.check === id && f.severity === "error");
  if (bad || !found.length) ctx.add(id, "fail", found.length ? "some outputs are not real media" : `no ${family} file with valid magic bytes`);
  else ctx.add(id, "pass", found.join("; "));
}

const SEVERITIES = ["critical", "high", "medium", "low", "info"];

async function checkReviewReport(ctx: Ctx): Promise<void> {
  const rel = "artifacts/review.json";
  if (!(await exists(ctx.ws(rel)))) return ctx.add("review-report", "fail", `${rel} missing`);
  let r: any;
  try {
    r = await readJson(ctx.ws(rel));
  } catch (e: any) {
    return ctx.add("review-report", "fail", `${rel} is not JSON: ${e.message}`);
  }
  const errs: string[] = [];
  if (r.verdict !== "accept" && r.verdict !== "reject") errs.push('verdict must be "accept" or "reject"');
  if (!Array.isArray(r.findings)) errs.push("findings must be an array");
  const findings: any[] = Array.isArray(r.findings) ? r.findings : [];
  const ids = new Set<string>();
  for (const [i, f] of findings.entries()) {
    if (typeof f?.id !== "string" || !f.id) errs.push(`findings[${i}].id missing`);
    else if (ids.has(f.id)) errs.push(`duplicate finding id ${f.id}`);
    else ids.add(f.id);
    if (!SEVERITIES.includes(f?.severity)) errs.push(`findings[${i}].severity must be one of ${SEVERITIES.join("/")}`);
    if (typeof f?.title !== "string" || !f.title) errs.push(`findings[${i}].title missing`);
    if (typeof f?.blocking !== "boolean") errs.push(`findings[${i}].blocking must be boolean`);
    if (typeof f?.evidence !== "string" || f.evidence.length < 20) errs.push(`findings[${i}].evidence must explain how to reproduce (>= 20 chars)`);
    if (typeof f?.location === "string") {
      const file = f.location.split(":")[0];
      if (file && !(await exists(ctx.ws(file)))) errs.push(`findings[${i}].location ${f.location} points at a file that does not exist`);
    } else errs.push(`findings[${i}].location must be "path:line"`);
  }
  const blocking = findings.filter((f) => f?.blocking === true).length;
  if (r.verdict === "reject" && blocking === 0) errs.push("a reject verdict needs at least one blocking finding");
  if (r.verdict === "accept" && blocking > 0) errs.push("an accept verdict cannot carry blocking findings");
  if (ctx.skill.id === "audit-specialist" && typeof r.area !== "string") errs.push('audit-specialist reports name their "area"');
  if (ctx.skill.id === "audit-judge") {
    for (const [i, f] of findings.entries()) if (typeof f?.reproduced !== "boolean") errs.push(`findings[${i}].reproduced must be boolean for the judge`);
  }
  for (const e of errs) ctx.finding("review-report", e, rel);
  ctx.add("review-report", errs.length ? "fail" : "pass", errs.length ? `${errs.length} schema problem(s)` : `verdict ${r.verdict}, ${findings.length} finding(s), ${blocking} blocking`);
}

async function checkSiteVerdict(ctx: Ctx): Promise<void> {
  const rel = "artifacts/site-verdict.json";
  if (!(await exists(ctx.ws(rel)))) return ctx.add("site-verdict", "fail", `${rel} missing`);
  let v: any;
  try {
    v = await readJson(ctx.ws(rel));
  } catch (e: any) {
    return ctx.add("site-verdict", "fail", `${rel} is not JSON: ${e.message}`);
  }
  const errs: string[] = [];
  if (v.verdict !== "pass" && v.verdict !== "block") errs.push('verdict must be "pass" or "block"');
  if (!Array.isArray(v.reasons)) errs.push("reasons must be an array of strings");
  if (v.verdict === "block" && !(v.reasons?.length > 0)) errs.push("a block verdict must give reasons");
  // cross-check with our own screen of the site under review
  let siteDir: string | null = null;
  for (const c of [".company/reads/site", "site", "dist"]) if (await exists(ctx.ws(`${c}/index.html`))) siteDir = ctx.ws(c);
  if (siteDir) {
    const screen = await siteContentCheck(siteDir);
    if (screen.verdict === "block" && v.verdict === "pass") {
      errs.push(`verdict "pass" contradicts the automatic screen (${screen.findings.filter((f) => f.severity === "block").map((f) => f.rule).join(", ")})`);
    }
  }
  for (const e of errs) ctx.finding("site-verdict", e, rel);
  ctx.add("site-verdict", errs.length ? "fail" : "pass", errs.length ? errs.join("; ") : `verdict ${v.verdict}${siteDir ? " (consistent with screen)" : ""}`);
}

export interface WorkflowPlanStep {
  skill: string;
  key?: string;
  dependsOn?: string[];
  objective?: string;
  paths?: string[];
}

/** Validate a workflow-planner proposal. `runnable` = ids of runnable skills. */
export function validateWorkflowPlan(plan: any, runnable?: Set<string>): string[] {
  const errs: string[] = [];
  if (!plan || typeof plan !== "object") return ["plan must be an object"];
  if (!["chain", "fan_out_join", "dag"].includes(plan.shape)) errs.push("shape must be chain, fan_out_join or dag");
  const steps: WorkflowPlanStep[] = Array.isArray(plan.steps) ? plan.steps : [];
  if (steps.length < 1 || steps.length > 6) errs.push("steps must have 1-6 entries");
  const keys = new Set<string>();
  for (const [i, s] of steps.entries()) {
    if (typeof s?.skill !== "string") errs.push(`steps[${i}].skill missing`);
    else if (runnable && !runnable.has(s.skill)) errs.push(`steps[${i}].skill ${s.skill} is not a runnable skill`);
    if (plan.shape === "dag") {
      if (typeof s.key !== "string" || !/^[a-z][a-z0-9_]{0,31}$/.test(s.key)) errs.push(`steps[${i}].key invalid`);
      else if (keys.has(s.key)) errs.push(`duplicate key ${s.key}`);
      else keys.add(s.key);
      if (!Array.isArray(s.dependsOn)) errs.push(`steps[${i}].dependsOn required for dag`);
    }
    if (s.objective !== undefined && (typeof s.objective !== "string" || s.objective.length > 3000)) errs.push(`steps[${i}].objective must be <= 3000 chars`);
    if (s.paths !== undefined && (!Array.isArray(s.paths) || s.paths.length > 16)) errs.push(`steps[${i}].paths must be <= 16 entries`);
  }
  if (plan.shape === "dag" && steps.length && steps.every((s) => typeof s?.key === "string" && Array.isArray(s.dependsOn))) {
    const seen = new Set<string>();
    const depended = new Set<string>();
    for (const s of steps) {
      for (const d of s.dependsOn!) {
        if (!seen.has(d)) errs.push(`step ${s.key} depends on ${d}, which is not an earlier step`);
        depended.add(d);
      }
      seen.add(s.key!);
    }
    const sinks = steps.filter((s) => !depended.has(s.key!));
    if (sinks.length !== 1) errs.push(`a dag must join into exactly one final step (found ${sinks.length})`);
  }
  if (plan.references !== undefined && (!Array.isArray(plan.references) || plan.references.length > 8)) errs.push("references must be <= 8 entries");
  return errs;
}

async function checkWorkflowPlan(ctx: Ctx): Promise<void> {
  const rel = "artifacts/workflow.json";
  if (!(await exists(ctx.ws(rel)))) return ctx.add("workflow-plan", "fail", `${rel} missing`);
  let plan: any;
  try {
    plan = await readJson(ctx.ws(rel));
  } catch (e: any) {
    return ctx.add("workflow-plan", "fail", `${rel} is not JSON: ${e.message}`);
  }
  let runnable: Set<string> | undefined;
  try {
    const { loadSkillCatalog } = await import("./skills.ts");
    const cat = await loadSkillCatalog(ctx.input.skillsDir);
    runnable = new Set(Object.values(cat.skills).filter((s) => s.kind === "runnable").map((s) => s.id));
  } catch {
    /* catalog unavailable: skip membership check */
  }
  const errs = validateWorkflowPlan(plan.draft ?? plan, runnable);
  for (const e of errs) ctx.finding("workflow-plan", e, rel);
  ctx.add("workflow-plan", errs.length ? "fail" : "pass", errs.length ? errs.join("; ") : `${(plan.draft ?? plan).steps.length} step(s), shape ${(plan.draft ?? plan).shape}`);
}

const ANSWER_VALIDATORS: Record<string, (v: unknown) => boolean> = {
  bool: (v) => typeof v === "boolean",
  address: (v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v),
  bytes32: (v) => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v),
  uint256: (v) => typeof v === "string" && /^\d{1,78}$/.test(v) && BigInt(v) < 2n ** 256n,
  "address[]": (v) => Array.isArray(v) && v.every((x) => ANSWER_VALIDATORS.address(x)),
  "bytes32[]": (v) => Array.isArray(v) && v.every((x) => ANSWER_VALIDATORS.bytes32(x)),
};

async function checkOracleAnswer(ctx: Ctx): Promise<void> {
  const rel = "artifacts/answer.json";
  if (!(await exists(ctx.ws(rel)))) return ctx.add("oracle-answer", "fail", `${rel} missing`);
  let a: any;
  try {
    a = await readJson(ctx.ws(rel));
  } catch (e: any) {
    return ctx.add("oracle-answer", "fail", `${rel} is not JSON: ${e.message}`);
  }
  const errs: string[] = [];
  const validate = ANSWER_VALIDATORS[a.answerType];
  if (!validate) errs.push(`answerType must be one of ${Object.keys(ANSWER_VALIDATORS).join(", ")}`);
  if (a.status === "refused" || a.status === "ambiguous") {
    if (typeof a.reason !== "string" || !a.reason) errs.push("a refused/ambiguous answer must give a reason");
  } else {
    if (validate && !validate(a.answer)) errs.push(`answer does not match answerType ${a.answerType}`);
    if (!Number.isInteger(a.chainId)) errs.push("chainId must be an integer");
    if (!/^\d+$/.test(String(a.fromBlock ?? "")) || !/^\d+$/.test(String(a.toBlock ?? ""))) errs.push("fromBlock/toBlock must be block numbers");
    else if (BigInt(a.fromBlock) > BigInt(a.toBlock)) errs.push("fromBlock > toBlock");
    if (!a.recipe || !Array.isArray(a.recipe.steps) || a.recipe.steps.length === 0) errs.push("recipe.steps must list the reads that reproduce the answer");
  }
  for (const e of errs) ctx.finding("oracle-answer", e, rel);
  ctx.add("oracle-answer", errs.length ? "fail" : "pass", errs.length ? errs.join("; ") : `${a.answerType} answer with ${a.recipe?.steps?.length ?? 0} recipe step(s)`);
}

async function checkFindingsResponse(ctx: Ctx): Promise<void> {
  const rel = "artifacts/responses.json";
  if (!(await exists(ctx.ws(rel)))) return ctx.add("findings-response", "fail", `${rel} missing`);
  let r: any;
  try {
    r = await readJson(ctx.ws(rel));
  } catch (e: any) {
    return ctx.add("findings-response", "fail", `${rel} is not JSON: ${e.message}`);
  }
  const errs: string[] = [];
  const responses: any[] = Array.isArray(r.responses) ? r.responses : [];
  if (!Array.isArray(r.responses)) errs.push("responses must be an array");
  for (const [i, x] of responses.entries()) {
    if (typeof x?.findingId !== "string") errs.push(`responses[${i}].findingId missing`);
    if (x?.action !== "fixed" && x?.action !== "disputed") errs.push(`responses[${i}].action must be fixed or disputed`);
    if (typeof x?.detail !== "string" || x.detail.length < 10) errs.push(`responses[${i}].detail must explain the fix or the dispute`);
  }
  const findingsPath = ctx.ws(".company/reads/findings.json");
  if (await exists(findingsPath)) {
    const input = await readJson(findingsPath).catch(() => null);
    const blocking: string[] = (input?.findings ?? []).filter((f: any) => f?.blocking).map((f: any) => f.id);
    const answered = new Set(responses.map((x) => x?.findingId));
    for (const id of blocking) if (!answered.has(id)) errs.push(`blocking finding ${id} has no response`);
    for (const id of answered) if (!blocking.includes(id)) ctx.finding("findings-response", `response to non-blocking or unknown finding ${id}`, rel, "warning");
  }
  for (const e of errs) ctx.finding("findings-response", e, rel);
  ctx.add("findings-response", errs.length ? "fail" : "pass", errs.length ? errs.join("; ") : `${responses.length} response(s)`);
}

async function checkGasReport(ctx: Ctx): Promise<void> {
  const rel = "artifacts/gas-report.json";
  if (!(await exists(ctx.ws(rel)))) return ctx.add("gas-report", "fail", `${rel} missing`);
  let g: any;
  try {
    g = await readJson(ctx.ws(rel));
  } catch (e: any) {
    return ctx.add("gas-report", "fail", `${rel} is not JSON: ${e.message}`);
  }
  const errs: string[] = [];
  if (!Array.isArray(g.contracts) || !g.contracts.length) errs.push("contracts[] must list every deployable contract");
  for (const [i, c] of (g.contracts ?? []).entries()) {
    if (typeof c?.name !== "string") errs.push(`contracts[${i}].name missing`);
    if (!Number.isInteger(c?.runtimeSize) || !Number.isInteger(c?.initcodeSize)) errs.push(`contracts[${i}] sizes must be integers`);
    if (typeof c?.deployable !== "boolean") errs.push(`contracts[${i}].deployable must be boolean`);
    else if (c.deployable && (c.runtimeSize > MAX_RUNTIME_SIZE || c.initcodeSize > MAX_INITCODE_SIZE)) errs.push(`contracts[${i}] ${c.name} marked deployable but exceeds size limits`);
  }
  if (!Array.isArray(g.functions)) errs.push("functions[] (gas per function) must be present");
  for (const e of errs) ctx.finding("gas-report", e, rel);
  ctx.add("gas-report", errs.length ? "fail" : "pass", errs.length ? errs.join("; ") : `${g.contracts.length} contract(s), ${g.functions.length} function row(s)`);
}

async function checkReadme(ctx: Ctx): Promise<void> {
  if (!(await exists(ctx.ws("README.md")))) return ctx.add("readme", "fail", "README.md missing");
  const t = await readFile(ctx.ws("README.md"), "utf8");
  const heads = [...t.matchAll(/^#{1,3} (.+)$/gm)].map((m) => m[1].toLowerCase());
  const need: [string, RegExp][] = [
    ["install/setup", /install|setup|getting started|requirements/],
    ["usage", /usage|use|run|deploy/],
    ["development/testing", /test|develop|contribut|build/],
  ];
  const missing = need.filter(([, re]) => !heads.some((h) => re.test(h))).map(([n]) => n);
  if (!/```/.test(t)) missing.push("at least one code block");
  if (t.length < 600) missing.push("more than 600 characters");
  ctx.add("readme", missing.length ? "fail" : "pass", missing.length ? `README.md lacks: ${missing.join(", ")}` : `${heads.length} heading(s)`);
}

async function checkLaunchManifest(ctx: Ctx): Promise<void> {
  if (!(await exists(ctx.ws("launch.json")))) return ctx.add("launch-manifest", "fail", "launch.json missing");
  let m: any;
  try {
    m = await readJson(ctx.ws("launch.json"));
  } catch (e: any) {
    return ctx.add("launch-manifest", "fail", `launch.json is not JSON: ${e.message}`);
  }
  const errs = validateLaunchManifest(m);
  if (!errs.length && !(await exists(ctx.ws(m.script.split(":")[0])))) errs.push(`script ${m.script} not found`);
  for (const e of errs) ctx.finding("launch-manifest", e, "launch.json");
  ctx.add("launch-manifest", errs.length ? "fail" : "pass", errs.length ? errs.join("; ") : `${m.kind} on chain ${m.chainId}`);
}

/* ---------------------------------------- Driver ------------------------------------------- */

const RUNNERS: Record<CheckId, (ctx: Ctx) => Promise<void> | void> = {
  paths: (c) => checkPaths(c, "paths"),
  "no-writes": (c) => checkPaths(c, "no-writes"),
  outputs: checkOutputs,
  "foundry-build": checkFoundryBuild,
  "foundry-test": checkFoundryTest,
  "foundry-sizes": checkFoundrySizes,
  "foundry-script": checkFoundryScript,
  "project-build": checkProjectBuild,
  "web-build": checkWebBuild,
  "site-screen": checkSiteScreen,
  "npm-check": checkNpm,
  indexer: checkIndexer,
  "research-citations": checkResearch,
  "media-image": (c) => checkMedia(c, "image"),
  "media-audio": (c) => checkMedia(c, "audio"),
  "media-video": (c) => checkMedia(c, "video"),
  "review-report": checkReviewReport,
  "site-verdict": checkSiteVerdict,
  "workflow-plan": checkWorkflowPlan,
  "oracle-answer": checkOracleAnswer,
  "findings-response": checkFindingsResponse,
  "gas-report": checkGasReport,
  readme: checkReadme,
  "launch-manifest": checkLaunchManifest,
};

export async function verifySubmission(input: VerifyInput): Promise<VerifyResult> {
  const started = Date.now();
  const skill = typeof input.skill === "string" ? await getSkill(input.skill, input.skillsDir) : input.skill;
  if (skill.kind !== "runnable") throw new Error(`skill ${skill.id} is a reference skill and cannot be verified as a step`);
  const changed = await diffTrees(input.workspaceDir, input.baseDir);
  const ctx = new Ctx(input, skill, changed);
  try {
    await checkSymlinks(ctx);
    const order: CheckId[] = [...skill.checks];
    // every submission gets the write-budget and outputs checks even if the skill forgot them
    if (!order.includes("paths") && !order.includes("no-writes")) order.unshift(skill.writes === "none" ? "no-writes" : "paths");
    if (!order.includes("outputs") && allOutputs(ctx).length) order.splice(1, 0, "outputs");
    for (const id of order) {
      if (ctx.checks.some((c) => c.id === id)) continue;
      const runner = RUNNERS[id];
      if (!runner) {
        ctx.add(id, "error", `unknown check id ${id}`);
        continue;
      }
      if (Date.now() > ctx.deadline) {
        ctx.add(id, "error", "verification budget exhausted before this check ran");
        continue;
      }
      try {
        await runner(ctx);
      } catch (e: any) {
        ctx.add(id, "error", `check crashed: ${e?.message ?? e}`);
      }
    }
  } finally {
    await ctx.cleanup();
  }
  const ok = ctx.checks.every((c) => c.status === "pass" || c.status === "skip");
  return { ok, skill: skill.id, checks: ctx.checks, findings: ctx.findings, changed, durationMs: Date.now() - started };
}
