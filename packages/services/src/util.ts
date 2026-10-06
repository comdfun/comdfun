import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import path from "node:path";

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export const HASH_RE = /^[0-9a-f]{64}$/;

export function assertHash(hash: string): void {
  if (!HASH_RE.test(hash)) throw new Error(`invalid sha256 hash: ${hash}`);
}

/** Canonical JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** Repo-relative POSIX path; rejects absolute paths and traversal. */
export function normalizeRelPath(p: string): string {
  const posix = p.replace(/\\/g, "/");
  if (posix.startsWith("/")) throw new Error(`absolute path not allowed: ${p}`);
  const norm = path.posix.normalize(posix);
  if (norm === ".." || norm.startsWith("../") || norm.includes("/../")) {
    throw new Error(`path escapes root: ${p}`);
  }
  return norm === "." ? "" : norm.replace(/\/$/, "");
}

export interface WalkedFile {
  /** POSIX path relative to the walk root. */
  path: string;
  abs: string;
  bytes: number;
  /** "file" or "symlink" (symlinks are never followed). */
  type: "file" | "symlink";
}

export const DEFAULT_IGNORES = [".git", "node_modules", "out", "cache", ".DS_Store"];

/** Recursively list files under root (no symlink following). `ignore` matches any path segment. */
export async function walkFiles(root: string, ignore: string[] = DEFAULT_IGNORES): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];
  const ignoreSet = new Set(ignore);
  async function rec(dir: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e: any) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of entries) {
      if (ignoreSet.has(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isSymbolicLink()) {
        const st = await lstat(abs);
        out.push({ path: r, abs, bytes: st.size, type: "symlink" });
      } else if (ent.isDirectory()) {
        await rec(abs, r);
      } else if (ent.isFile()) {
        const st = await lstat(abs);
        out.push({ path: r, abs, bytes: st.size, type: "file" });
      }
    }
  }
  await rec(root, "");
  return out;
}

/** path -> sha256 of every file (symlinks hashed by their target string). */
export async function hashTree(root: string, ignore?: string[]): Promise<Map<string, string>> {
  const files = await walkFiles(root, ignore);
  const map = new Map<string, string>();
  for (const f of files) {
    if (f.type === "symlink") {
      map.set(f.path, sha256Hex(`symlink:${await readlink(f.abs)}`));
    } else {
      map.set(f.path, sha256Hex(await readFile(f.abs)));
    }
  }
  return map;
}

/** Convert a simple glob (`*`, `**`, `?`) into a RegExp anchored on the whole POSIX path. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/**
 * True when `file` is covered by one of `allowed`. An entry is an exact file, a directory prefix
 * (`src/` or `src`), or a glob. `"*"`/`"**"` allow everything.
 */
export function pathAllowed(file: string, allowed: string[]): boolean {
  for (const raw of allowed) {
    const a = raw.replace(/\\/g, "/").replace(/^\.\//, "");
    if (a === "*" || a === "**" || a === "") return true;
    if (/[*?]/.test(a)) {
      if (globToRegExp(a).test(file)) return true;
      continue;
    }
    const dir = a.replace(/\/$/, "");
    if (file === dir || file.startsWith(`${dir}/`)) return true;
  }
  return false;
}

export function envInt(env: Record<string, string | undefined>, key: string, dflt: number): number {
  const v = env[key];
  if (v === undefined || v === "") return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
  return n;
}
