/**
 * Media types: by extension (for serving) and by magic bytes (for verifying that a declared image,
 * audio or video output really is one).
 */

const EXT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  cjs: "text/javascript; charset=utf-8",
  map: "application/json; charset=utf-8",
  json: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  bmp: "image/bmp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
  sol: "text/plain; charset=utf-8",
  ts: "text/plain; charset=utf-8",
  tsx: "text/plain; charset=utf-8",
  toml: "text/plain; charset=utf-8",
  yaml: "text/yaml; charset=utf-8",
  yml: "text/yaml; charset=utf-8",
  gz: "application/gzip",
  tar: "application/x-tar",
  zip: "application/zip",
};

export function mediaTypeForPath(p: string): string {
  const base = p.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return EXT_TYPES[base.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}

function startsWith(buf: Uint8Array, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[offset + i] !== sig[i]) return false;
  return true;
}

function ascii(buf: Uint8Array, start: number, end: number): string {
  return Buffer.from(buf.subarray(start, end)).toString("latin1");
}

/**
 * Sniff a media type from the leading bytes. Returns null when no binary signature matches;
 * text formats are reported as `text/plain`, `application/json`, `text/markdown`, `text/html`
 * or `image/svg+xml` on a best-effort basis.
 */
export function sniffMediaType(buf: Uint8Array): string | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(buf, 0, 6) === "GIF87a" || ascii(buf, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return "image/webp";
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WAVE") return "audio/wav";
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "AVI ") return "video/x-msvideo";
  if (startsWith(buf, [0x42, 0x4d]) && buf.length > 26 && [12, 40, 52, 56, 108, 124].includes(Buffer.from(buf).readUInt32LE(14)))
    return "image/bmp";
  if (startsWith(buf, [0x00, 0x00, 0x01, 0x00])) return "image/x-icon";
  if (ascii(buf, 4, 8) === "ftyp") {
    const brand = ascii(buf, 8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (brand === "heic" || brand === "heix" || brand === "mif1") return "image/heic";
    if (brand === "M4A " || brand === "M4B ") return "audio/mp4";
    if (brand === "qt  ") return "video/quicktime";
    return "video/mp4";
  }
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  if (ascii(buf, 0, 4) === "OggS") {
    const head = ascii(buf, 0, Math.min(buf.length, 64));
    if (head.includes("theora")) return "video/ogg";
    return "audio/ogg";
  }
  if (ascii(buf, 0, 4) === "fLaC") return "audio/flac";
  if (ascii(buf, 0, 3) === "ID3") return "audio/mpeg";
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
    // MPEG audio frame sync; AAC ADTS uses 0xFFF1 / 0xFFF9
    if ((buf[1] & 0xf6) === 0xf0) return "audio/aac";
    return "audio/mpeg";
  }
  if (ascii(buf, 0, 5) === "%PDF-") return "application/pdf";
  if (startsWith(buf, [0x1f, 0x8b])) return "application/gzip";
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  if (startsWith(buf, [0x00, 0x61, 0x73, 0x6d])) return "application/wasm";
  if (ascii(buf, 0, 4) === "wOFF") return "font/woff";
  if (ascii(buf, 0, 4) === "wOF2") return "font/woff2";

  // Text heuristics: reject if NUL bytes appear in the first 8 KiB.
  const head = buf.subarray(0, Math.min(buf.length, 8192));
  if (head.includes(0)) return null;
  const text = Buffer.from(head).toString("utf8").replace(/^﻿/, "").trimStart();
  if (/^<svg[\s>]/i.test(text) || (/^<\?xml/i.test(text) && /<svg[\s>]/i.test(text))) return "image/svg+xml";
  if (/^<!doctype html/i.test(text) || /^<html[\s>]/i.test(text)) return "text/html";
  if (/^[[{]/.test(text)) {
    try {
      JSON.parse(Buffer.from(buf).toString("utf8"));
      return "application/json";
    } catch {
      /* fall through */
    }
  }
  if (/^#{1,6} /m.test(text) || /\[[^\]]+\]\([^)]+\)/.test(text)) return "text/markdown";
  return "text/plain";
}

/** Strip parameters and lowercase: `text/html; charset=utf-8` -> `text/html`. */
export function essence(mediaType: string): string {
  return mediaType.split(";")[0].trim().toLowerCase();
}

/**
 * Does the sniffed type satisfy the declared one? Binary declarations (image/audio/video/pdf/…)
 * must match their family exactly (or a known alias); text declarations accept any text sniff.
 */
export function mediaTypeCompatible(declared: string, sniffed: string | null): boolean {
  const d = essence(declared);
  if (d === "application/octet-stream") return true;
  if (sniffed === null) return false;
  const s = essence(sniffed);
  if (d === s) return true;
  const aliases: Record<string, string[]> = {
    "audio/mp3": ["audio/mpeg"],
    "audio/x-wav": ["audio/wav"],
    "audio/wave": ["audio/wav"],
    "audio/m4a": ["audio/mp4"],
    "audio/x-m4a": ["audio/mp4"],
    "video/x-matroska": ["video/webm"],
    "image/jpg": ["image/jpeg"],
  };
  if (aliases[d]?.includes(s)) return true;
  const textLike = (t: string) =>
    t.startsWith("text/") || t === "application/json" || t === "image/svg+xml" || t.endsWith("+json") || t === "application/xml";
  if (textLike(d) && d !== "image/svg+xml") return textLike(s);
  if (d === "image/svg+xml") return s === "image/svg+xml";
  return false;
}

export type MediaFamily = "image" | "audio" | "video";

export function mediaFamily(mediaType: string | null): MediaFamily | null {
  if (!mediaType) return null;
  const e = essence(mediaType);
  if (e === "image/svg+xml") return null; // not a raster produced by a media tool
  if (e.startsWith("image/")) return "image";
  if (e.startsWith("audio/")) return "audio";
  if (e.startsWith("video/")) return "video";
  return null;
}
