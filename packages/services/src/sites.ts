/**
 * Site hosting on our own storage (replaces IMD's IPFS + ENS):
 *  - siteContentCheck: policy screen of a static export (feeds the `site-content-check` skill)
 *  - publishSite: upload a static export under `sites/<label>/<version>/...` with a manifest
 *  - serveSite: resolve a request for `<label>.<SITES_DOMAIN>` to {status, headers, body}
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BlobStore } from "./blobstore.ts";
import { mediaTypeForPath } from "./media.ts";
import { canonicalJson, sha256Hex, walkFiles } from "./util.ts";

export const SITE_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

/* ------------------------------------------------------------------------------------------- */
/* Content screen                                                                              */
/* ------------------------------------------------------------------------------------------- */

export type ScreenSeverity = "block" | "warn";

export interface ScreenFinding {
  rule: string;
  severity: ScreenSeverity;
  file?: string;
  line?: number;
  detail: string;
}

export interface SiteScreenResult {
  verdict: "pass" | "review" | "block";
  findings: ScreenFinding[];
  stats: { files: number; totalBytes: number; externalHosts: string[] };
}

export interface SiteScreenOptions {
  maxTotalBytes?: number;
  maxFileBytes?: number;
  maxFiles?: number;
  /** hosts external <script>/module imports may load from */
  scriptHosts?: string[];
  /** hosts external stylesheets/fonts may load from */
  styleHosts?: string[];
}

export const DEFAULT_SCRIPT_HOSTS = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com", "esm.sh", "code.jquery.com", "cdn.tailwindcss.com"];
export const DEFAULT_STYLE_HOSTS = [...DEFAULT_SCRIPT_HOSTS, "fonts.googleapis.com", "fonts.gstatic.com"];

const BLOCKED_EXTENSIONS = /\.(exe|dll|msi|dmg|pkg|apk|ipa|bat|cmd|com|scr|jar|vbs|ps1|deb|rpm|appimage)$/i;
const SERVER_SIDE_EXTENSIONS = /\.(php|phtml|asp|aspx|jsp|cgi|pl|py|rb|env|pem|key)$/i;
const TEXT_EXTENSIONS = /\.(html?|m?js|cjs|css|json|svg|txt|xml|webmanifest|map)$/i;

interface PatternRule {
  rule: string;
  severity: ScreenSeverity;
  re: RegExp;
  detail: string;
}

const PATTERN_RULES: PatternRule[] = [
  { rule: "drainer-kit", severity: "block", re: /\b(inferno|angel|pink|monkey|venom|medusa|ace|nova|vanilla)[\s_-]?drainer\b/i, detail: "names a known wallet-drainer kit" },
  { rule: "raw-eth-sign", severity: "block", re: /["'`]eth_sign["'`]/, detail: "requests raw eth_sign (blind hash signing)" },
  {
    rule: "hardcoded-approval-for-all",
    severity: "block",
    re: /setApprovalForAll\s*\(\s*["'`]?0x[0-9a-fA-F]{40}["'`]?\s*,\s*(?:true|!0|1)/,
    detail: "asks for setApprovalForAll to a hard-coded operator",
  },
  {
    rule: "hardcoded-unlimited-approve",
    severity: "block",
    re: /\.approve\s*\(\s*["'`]?0x[0-9a-fA-F]{40}["'`]?\s*,\s*(?:["'`]?0x[fF]{64}["'`]?|[\w.]*max[_]?uint(?:256)?|2n\s*\*\*\s*256n|115792089237316195423570985008687907853269984665640564039457584007913129639935)/i,
    detail: "unlimited approve() to a hard-coded spender",
  },
  {
    rule: "secret-collection",
    severity: "block",
    re: /(placeholder|aria-label|name|id)\s*=\s*["'][^"']*(seed[\s_-]?phrase|recovery[\s_-]?phrase|mnemonic|private[\s_-]?key|secret[\s_-]?key)[^"']*["']/i,
    detail: "a form field asks for a seed phrase or private key",
  },
  { rule: "obfuscated-eval", severity: "block", re: /\b(?:eval|new\s+Function)\s*\(\s*(?:atob|unescape|decodeURIComponent|String\.fromCharCode)\s*\(/, detail: "evaluates decoded/obfuscated code" },
  { rule: "document-write-unescape", severity: "block", re: /document\.write\s*\(\s*(?:unescape|atob)\s*\(/, detail: "writes decoded markup into the page" },
  { rule: "crypto-miner", severity: "block", re: /\b(coinhive|coin-hive|cryptonight|coinimp|webminerpool|crypto-loot)\b/i, detail: "browser crypto-miner" },
  { rule: "telegram-exfiltration", severity: "block", re: /api\.telegram\.org\/bot/i, detail: "posts data to a Telegram bot (common drainer exfiltration)" },
  { rule: "discord-webhook", severity: "warn", re: /discord(?:app)?\.com\/api\/webhooks\//i, detail: "posts data to a Discord webhook" },
  {
    rule: "keystroke-capture",
    severity: "warn",
    re: /addEventListener\s*\(\s*["'`]key(?:down|up|press)["'`][\s\S]{0,200}fetch\s*\(/,
    detail: "captures keystrokes near a network request",
  },
  { rule: "affiliation-claim", severity: "warn", re: /<title>[^<]*\brobinhood\b[^<]*<\/title>/i, detail: "title uses a third-party brand; ensure it states it is not affiliated" },
];

function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function hostOf(url: string): string | null {
  try {
    const u = new URL(url.startsWith("//") ? `https:${url}` : url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostAllowed(host: string, allow: string[]): boolean {
  return allow.some((a) => host === a || host.endsWith(`.${a}`));
}

/** Policy screen of a static export directory. Pure: reads files, never executes them. */
export async function siteContentCheck(distDir: string, opts: SiteScreenOptions = {}): Promise<SiteScreenResult> {
  const maxTotal = opts.maxTotalBytes ?? 50 * 1024 * 1024;
  const maxFile = opts.maxFileBytes ?? 15 * 1024 * 1024;
  const maxFiles = opts.maxFiles ?? 2000;
  const scriptHosts = opts.scriptHosts ?? DEFAULT_SCRIPT_HOSTS;
  const styleHosts = opts.styleHosts ?? DEFAULT_STYLE_HOSTS;
  const findings: ScreenFinding[] = [];
  const files = await walkFiles(distDir, [".git", ".DS_Store"]);
  const external = new Set<string>();
  let total = 0;

  if (!files.some((f) => f.path === "index.html")) {
    findings.push({ rule: "missing-index", severity: "block", detail: "the export has no index.html at its root" });
  }
  if (files.length > maxFiles) findings.push({ rule: "too-many-files", severity: "block", detail: `${files.length} files > ${maxFiles}` });

  for (const f of files) {
    total += f.bytes;
    if (f.type === "symlink") {
      findings.push({ rule: "symlink", severity: "block", file: f.path, detail: "symlinks are not allowed in a site export" });
      continue;
    }
    if (f.bytes > maxFile) findings.push({ rule: "file-too-large", severity: "block", file: f.path, detail: `${f.bytes} bytes > ${maxFile}` });
    if (BLOCKED_EXTENSIONS.test(f.path)) findings.push({ rule: "executable-download", severity: "block", file: f.path, detail: "executable or installer file" });
    else if (SERVER_SIDE_EXTENSIONS.test(f.path))
      findings.push({ rule: "server-side-file", severity: "warn", file: f.path, detail: "server-side or secret-looking file in a static export" });
    if (!TEXT_EXTENSIONS.test(f.path) || f.bytes > maxFile) continue;

    const text = await readFile(f.abs, "utf8");
    for (const r of PATTERN_RULES) {
      const m = r.re.exec(text);
      if (m) findings.push({ rule: r.rule, severity: r.severity, file: f.path, line: lineOf(text, m.index), detail: r.detail });
    }
    if (/\.html?$/i.test(f.path)) {
      for (const m of text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
        const host = hostOf(m[1]);
        if (!host) continue;
        external.add(host);
        if (!hostAllowed(host, scriptHosts)) {
          findings.push({ rule: "external-script", severity: "block", file: f.path, line: lineOf(text, m.index ?? 0), detail: `script from unlisted host ${host}` });
        }
      }
      for (const m of text.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
        const host = hostOf(m[1]);
        if (!host) continue;
        external.add(host);
        const isScript = /rel\s*=\s*["']?modulepreload/i.test(m[0]) || /as\s*=\s*["']?script/i.test(m[0]);
        const allow = isScript ? scriptHosts : styleHosts;
        if (/rel\s*=\s*["']?(stylesheet|modulepreload|preload)/i.test(m[0]) && !hostAllowed(host, allow)) {
          findings.push({ rule: isScript ? "external-script" : "external-style", severity: isScript ? "block" : "warn", file: f.path, line: lineOf(text, m.index ?? 0), detail: `${isScript ? "script" : "stylesheet"} from unlisted host ${host}` });
        }
      }
      for (const m of text.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
        const host = hostOf(m[1]);
        if (host) {
          external.add(host);
          findings.push({ rule: "external-iframe", severity: "warn", file: f.path, line: lineOf(text, m.index ?? 0), detail: `embeds ${host} in an iframe` });
        }
      }
      for (const m of text.matchAll(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*url\s*=\s*([^"'>\s]+)/gi)) {
        const host = hostOf(m[1]);
        if (host) findings.push({ rule: "meta-refresh-redirect", severity: "warn", file: f.path, line: lineOf(text, m.index ?? 0), detail: `redirects to ${host}` });
      }
    }
    if (/\.(m?js|cjs)$/i.test(f.path)) {
      for (const m of text.matchAll(/\bimport\s*\(\s*["'`](https?:\/\/[^"'`]+)["'`]\s*\)|\bimportScripts\s*\(\s*["'`](https?:\/\/[^"'`]+)["'`]/g)) {
        const host = hostOf(m[1] ?? m[2]);
        if (!host) continue;
        external.add(host);
        if (!hostAllowed(host, scriptHosts)) {
          findings.push({ rule: "external-script", severity: "block", file: f.path, line: lineOf(text, m.index ?? 0), detail: `runtime import from unlisted host ${host}` });
        }
      }
    }
  }
  if (total > maxTotal) findings.push({ rule: "site-too-large", severity: "block", detail: `${total} bytes > ${maxTotal}` });

  const verdict = findings.some((f) => f.severity === "block") ? "block" : findings.length ? "review" : "pass";
  return { verdict, findings, stats: { files: files.length, totalBytes: total, externalHosts: [...external].sort() } };
}

/* ------------------------------------------------------------------------------------------- */
/* Publish                                                                                     */
/* ------------------------------------------------------------------------------------------- */

export interface SiteManifestFile {
  path: string;
  sha256: string;
  mediaType: string;
  bytes: number;
}

export interface SiteManifest {
  schema: "company.site.v1";
  label: string;
  version: string;
  files: SiteManifestFile[];
}

export interface SitePointer {
  label: string;
  version: string;
  manifestHash: string;
  publishedAt: string;
  previous: string | null;
}

export interface PublishSiteInput {
  label: string;
  distDir: string;
  store: BlobStore;
  /** e.g. "sites.comd.fun"; default env SITES_DOMAIN */
  sitesDomain?: string;
  /** run siteContentCheck first and refuse a `block` verdict (default true) */
  screen?: boolean | SiteScreenOptions;
  /** make this version current (default true) */
  activate?: boolean;
  now?: Date;
}

export interface PublishSiteResult {
  label: string;
  version: string;
  url: string;
  manifestHash: string;
  manifestUrl: string;
  files: number;
  bytes: number;
  screen?: SiteScreenResult;
}

export class SitePolicyError extends Error {
  readonly screen: SiteScreenResult;
  constructor(screen: SiteScreenResult) {
    super(`site refused by content screen: ${screen.findings.filter((f) => f.severity === "block").map((f) => f.rule).join(", ")}`);
    this.screen = screen;
  }
}

export function siteUrl(label: string, sitesDomain = process.env.SITES_DOMAIN ?? "sites.localhost"): string {
  return `https://${label}.${sitesDomain.replace(/^\.+|\/+$/g, "")}`;
}

const pointerKey = (label: string) => `sites/${label}/current.json`;
const manifestKey = (label: string, version: string) => `sites/${label}/${version}/manifest.json`;
const fileKey = (label: string, version: string, p: string) => `sites/${label}/${version}/files/${p}`;

export async function publishSite(input: PublishSiteInput): Promise<PublishSiteResult> {
  const { label, distDir, store } = input;
  if (!SITE_LABEL_RE.test(label)) throw new Error(`invalid site label: ${label}`);
  let screen: SiteScreenResult | undefined;
  if (input.screen !== false) {
    screen = await siteContentCheck(distDir, typeof input.screen === "object" ? input.screen : {});
    if (screen.verdict === "block") throw new SitePolicyError(screen);
  }
  const walked = await walkFiles(distDir, [".git", ".DS_Store"]);
  if (!walked.some((f) => f.path === "index.html")) throw new Error("site export has no index.html");
  const files: SiteManifestFile[] = [];
  const contents = new Map<string, Buffer>();
  for (const f of walked) {
    if (f.type !== "file") throw new Error(`site export contains a symlink: ${f.path}`);
    const data = await readFile(f.abs);
    contents.set(f.path, data);
    files.push({ path: f.path, sha256: sha256Hex(data), mediaType: mediaTypeForPath(f.path), bytes: data.length });
  }
  // version = hash of the file table only, so identical exports get the same version
  const version = sha256Hex(canonicalJson(files)).slice(0, 16);
  const manifest: SiteManifest = { schema: "company.site.v1", label, version, files };
  const manifestJson = canonicalJson(manifest);
  const manifestHash = sha256Hex(manifestJson);

  for (const f of files) {
    await store.putObject(fileKey(label, version, f.path), contents.get(f.path)!, { mediaType: f.mediaType, cacheControl: cacheControlFor(f.path) });
  }
  await store.putObject(manifestKey(label, version), manifestJson, { mediaType: "application/json" });
  const cas = await store.put(manifestJson, { mediaType: "application/json" });

  if (input.activate !== false) {
    const prev = await readPointer(store, label);
    const pointer: SitePointer = {
      label,
      version,
      manifestHash,
      publishedAt: (input.now ?? new Date()).toISOString(),
      previous: prev && prev.version !== version ? prev.version : (prev?.previous ?? null),
    };
    await store.putObject(pointerKey(label), JSON.stringify(pointer), { mediaType: "application/json", cacheControl: "no-cache" });
    pointerCache.delete(cacheKey(store, label));
  }
  return {
    label,
    version,
    url: siteUrl(label, input.sitesDomain),
    manifestHash,
    manifestUrl: cas.url,
    files: files.length,
    bytes: files.reduce((a, f) => a + f.bytes, 0),
    screen,
  };
}

export async function readPointer(store: BlobStore, label: string): Promise<SitePointer | null> {
  const obj = await store.getObject(pointerKey(label));
  return obj ? (JSON.parse(obj.data.toString("utf8")) as SitePointer) : null;
}

export async function getSiteManifest(store: BlobStore, label: string, version?: string): Promise<SiteManifest | null> {
  const v = version ?? (await readPointer(store, label))?.version;
  if (!v) return null;
  const obj = await store.getObject(manifestKey(label, v));
  return obj ? (JSON.parse(obj.data.toString("utf8")) as SiteManifest) : null;
}

/* ------------------------------------------------------------------------------------------- */
/* Serve                                                                                       */
/* ------------------------------------------------------------------------------------------- */

export interface ServeResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export interface ServeOptions {
  version?: string;
  ifNoneMatch?: string;
  /** pointer cache TTL (default 15 s, matching IMD's by-label cache) */
  pointerTtlMs?: number;
  method?: string;
}

const HASHED_ASSET_RE = /[.-](?=[A-Za-z0-9_]*\d)[A-Za-z0-9_]{8,}\.[a-z0-9]+$/;

export function cacheControlFor(p: string): string {
  if (/\.html?$/i.test(p)) return "public, max-age=0, must-revalidate";
  if (HASHED_ASSET_RE.test(p.split("/").pop() ?? "")) return "public, max-age=31536000, immutable";
  return "public, max-age=300";
}

const pointerCache = new Map<string, { at: number; pointer: SitePointer | null }>();
const manifestCache = new Map<string, Map<string, SiteManifestFile>>();
const storeIds = new WeakMap<BlobStore, number>();
let nextStoreId = 1;
function cacheKey(store: BlobStore, label: string): string {
  let id = storeIds.get(store);
  if (!id) storeIds.set(store, (id = nextStoreId++));
  return `${id}:${label}`;
}

function textResponse(status: number, msg: string): ServeResponse {
  return { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }, body: Buffer.from(msg) };
}

/** Resolve `GET <path>` for `<label>.<SITES_DOMAIN>`. Never throws for client errors. */
export async function serveSite(store: BlobStore, label: string, reqPath: string, opts: ServeOptions = {}): Promise<ServeResponse> {
  if (!SITE_LABEL_RE.test(label)) return textResponse(404, "unknown_site");
  const method = (opts.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return { ...textResponse(405, "method_not_allowed"), headers: { ...textResponse(405, "").headers, allow: "GET, HEAD" } };

  let version = opts.version;
  if (!version) {
    const key = cacheKey(store, label);
    const ttl = opts.pointerTtlMs ?? 15_000;
    let hit = pointerCache.get(key);
    if (!hit || Date.now() - hit.at > ttl) {
      hit = { at: Date.now(), pointer: await readPointer(store, label) };
      pointerCache.set(key, hit);
    }
    version = hit.pointer?.version;
  }
  if (!version) return textResponse(404, "unknown_site");

  const mKey = `${label}/${version}`;
  let table = manifestCache.get(mKey);
  if (!table) {
    const manifest = await getSiteManifest(store, label, version);
    if (!manifest) return textResponse(404, "unknown_site");
    table = new Map(manifest.files.map((f) => [f.path, f]));
    manifestCache.set(mKey, table);
    if (manifestCache.size > 500) manifestCache.delete(manifestCache.keys().next().value!);
  }

  let p: string;
  try {
    p = decodeURIComponent((reqPath.split("?")[0].split("#")[0] || "/"));
  } catch {
    return textResponse(400, "bad_path");
  }
  if (p.includes("\0")) return textResponse(400, "bad_path");
  p = path.posix.normalize(`/${p}`).replace(/^\/+/, "");
  if (p.startsWith("..")) return textResponse(400, "bad_path");

  let entry: SiteManifestFile | undefined;
  let status = 200;
  if (p === "" || p.endsWith("/")) entry = table.get(`${p}index.html`);
  else entry = table.get(p) ?? table.get(`${p}/index.html`) ?? table.get(`${p}.html`);
  if (!entry) {
    const last = p.split("/").pop() ?? "";
    if (!last.includes(".")) entry = table.get("index.html"); // SPA fallback for client-side routes
    else {
      entry = table.get("404.html");
      status = 404;
    }
  }
  if (!entry) return textResponse(404, "not_found");

  const etag = `"${entry.sha256}"`;
  const headers: Record<string, string> = {
    "content-type": entry.mediaType,
    etag,
    "cache-control": status === 200 ? cacheControlFor(entry.path) : "no-cache",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-site-version": version,
  };
  if (status === 200 && opts.ifNoneMatch && opts.ifNoneMatch.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)) {
    return { status: 304, headers, body: Buffer.alloc(0) };
  }
  const obj = await store.getObject(fileKey(label, version, entry.path));
  if (!obj) return textResponse(502, "site_file_missing");
  if (obj.hash !== entry.sha256) return textResponse(502, "site_file_corrupt");
  headers["content-length"] = String(obj.data.length);
  return { status, headers, body: method === "HEAD" ? Buffer.alloc(0) : obj.data };
}
