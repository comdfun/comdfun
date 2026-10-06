/** Minimal deterministic ustar writer (regular files only) + gzip, for dry-run repo snapshots. */
import { gzipSync } from "node:zlib";

export interface TarEntry {
  path: string;
  data: Uint8Array;
  mode?: number;
}

function octal(n: number, len: number): string {
  return n.toString(8).padStart(len - 1, "0") + "\0";
}

function header(name: string, size: number, mode: number): Buffer {
  const h = Buffer.alloc(512, 0);
  let prefix = "";
  let base = name;
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf("/", 155);
    if (cut <= 0 || Buffer.byteLength(name.slice(cut + 1)) > 100) throw new Error(`path too long for ustar: ${name}`);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
  }
  h.write(base, 0, 100, "utf8");
  h.write(octal(mode, 8), 100, 8, "ascii");
  h.write(octal(0, 8), 108, 8, "ascii"); // uid
  h.write(octal(0, 8), 116, 8, "ascii"); // gid
  h.write(octal(size, 12), 124, 12, "ascii");
  h.write(octal(0, 12), 136, 12, "ascii"); // mtime 0 => deterministic
  h.fill(" ", 148, 156); // checksum placeholder
  h.write("0", 156, 1, "ascii"); // regular file
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(octal(sum, 7) + " ", 148, 8, "ascii");
  return h;
}

export function tarGz(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of [...entries].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const data = Buffer.from(e.data);
    parts.push(header(e.path, data.length, e.mode ?? 0o644), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}
