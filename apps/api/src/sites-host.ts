/**
 * Static site hosting on our storage — the `ipfs` field of IMD's API, re-pointed. Layout is the same as
 * @company/services sites.ts (so either side can publish and either can serve):
 *
 *   sites/<label>/current.json                 pointer {label, version, manifestHash, publishedAt, previous}
 *   sites/<label>/<version>/manifest.json      {schema:"company.site.v1", label, version, files[]}
 *   sites/<label>/<version>/files/<path>       bytes
 *
 * Served at https://<label>.<SITES_DOMAIN>/ by the API (Host header routing).
 */
import { posix } from "node:path";
import { canonicalJson, sha256Hex, SITE_LABEL_RE } from "@company/protocol";
import type { BlobStore } from "./storage.ts";

export interface SiteFile { path: string; data: Buffer; mediaType?: string }
export interface ManifestFile { path: string; sha256: string; mediaType: string; bytes: number }
export interface Pointer { label: string; version: string; manifestHash: string; publishedAt: string; previous: string | null }

const MEDIA: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8", json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", ico: "image/x-icon", txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8",
  woff: "font/woff", woff2: "font/woff2", wasm: "application/wasm", mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm",
  xml: "application/xml", pdf: "application/pdf", map: "application/json",
};

export function mediaTypeFor(p: string): string {
  return MEDIA[p.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

export function siteUrl(label: string, sitesDomain: string): string {
  const local = /localhost|127\.0\.0\.1/.test(sitesDomain);
  return `${local ? "http" : "https"}://${label}.${sitesDomain}`;
}

export async function publishSiteFiles(store: BlobStore, label: string, files: SiteFile[], sitesDomain: string, now = new Date()) {
  if (!SITE_LABEL_RE.test(label)) throw new Error(`invalid site label: ${label}`);
  if (!files.some((f) => f.path === "index.html")) throw new Error("site export has no index.html");
  const table: ManifestFile[] = files
    .map((f) => ({ path: f.path, sha256: sha256Hex(f.data), mediaType: f.mediaType ?? mediaTypeFor(f.path), bytes: f.data.length }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  const version = sha256Hex(canonicalJson(table)).slice(0, 16);
  const manifest = { schema: "company.site.v1", label, version, files: table };
  const manifestJson = canonicalJson(manifest);
  const manifestHash = sha256Hex(manifestJson);
  for (const f of files) await store.putObject(`sites/${label}/${version}/files/${f.path}`, f.data, { mediaType: f.mediaType ?? mediaTypeFor(f.path) });
  await store.putObject(`sites/${label}/${version}/manifest.json`, manifestJson, { mediaType: "application/json" });
  await store.put(manifestJson, { mediaType: "application/json" });
  const prevObj = await store.getObject(`sites/${label}/current.json`);
  const prev = prevObj ? (JSON.parse(prevObj.data.toString("utf8")) as Pointer) : null;
  const pointer: Pointer = { label, version, manifestHash, publishedAt: now.toISOString(), previous: prev && prev.version !== version ? prev.version : prev?.previous ?? null };
  await store.putObject(`sites/${label}/current.json`, JSON.stringify(pointer), { mediaType: "application/json" });
  pointerCache.delete(label);
  return { label, version, url: siteUrl(label, sitesDomain), manifestHash, files: table.length, bytes: table.reduce((a, f) => a + f.bytes, 0) };
}

const pointerCache = new Map<string, { at: number; p: Pointer | null }>();

export async function serveSiteFile(store: BlobStore, label: string, reqPath: string, method = "GET"): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const text = (status: number, msg: string) => ({ status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }, body: Buffer.from(msg) });
  if (!SITE_LABEL_RE.test(label)) return text(404, "unknown_site");
  if (method !== "GET" && method !== "HEAD") return text(405, "method_not_allowed");
  let hit = pointerCache.get(label);
  if (!hit || Date.now() - hit.at > 15_000) {
    const o = await store.getObject(`sites/${label}/current.json`);
    hit = { at: Date.now(), p: o ? (JSON.parse(o.data.toString("utf8")) as Pointer) : null };
    pointerCache.set(label, hit);
  }
  if (!hit.p) return text(404, "unknown_site");
  const mo = await store.getObject(`sites/${label}/${hit.p.version}/manifest.json`);
  if (!mo) return text(404, "unknown_site");
  const table = new Map<string, ManifestFile>((JSON.parse(mo.data.toString("utf8")).files as ManifestFile[]).map((f) => [f.path, f]));
  let p: string;
  try { p = decodeURIComponent(reqPath.split("?")[0] || "/"); } catch { return text(400, "bad_path"); }
  p = posix.normalize(`/${p}`).replace(/^\/+/, "");
  if (p.startsWith("..") || p.includes("\0")) return text(400, "bad_path");
  let status = 200;
  let entry = p === "" || p.endsWith("/") ? table.get(`${p}index.html`) : table.get(p) ?? table.get(`${p}/index.html`) ?? table.get(`${p}.html`);
  if (!entry) {
    const last = p.split("/").pop() ?? "";
    if (!last.includes(".")) entry = table.get("index.html");
    else {
      entry = table.get("404.html");
      status = 404;
      if (!entry) return text(404, "not_found");
    }
  }
  const e = entry!;
  const obj = await store.getObject(`sites/${label}/${hit.p.version}/files/${e.path}`);
  if (!obj) return text(404, "not_found");
  return {
    status,
    headers: {
      "content-type": e.mediaType,
      "cache-control": /\.html?$/.test(e.path) ? "public, max-age=0, must-revalidate" : "public, max-age=300",
      etag: `"${e.sha256}"`,
      "x-company-site": `${label}@${hit.p.version}`,
    },
    body: obj.data,
  };
}
