// Minimal PNG encoder (8-bit RGB, filter 0) with nearest-neighbour upscale. zlib from node:zlib.
import { deflateSync } from "node:zlib";
import { Raster, T, type Color } from "./raster.js";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Encode a raster as PNG, each source pixel becoming a scale×scale block.
 * Transparent pixels → `background`; pass `null` for an RGBA PNG with real transparency.
 */
export function encodePNG(r: Raster, scale = 1, background: Color | null = 0x000000): Buffer {
  scale = Math.max(1, Math.floor(scale));
  if (background === null) return encodeRGBA(r, scale);
  const W = r.w * scale, H = r.h * scale;
  const stride = W * 3 + 1;
  const raw = Buffer.alloc(stride * H);
  for (let y = 0; y < r.h; y++) {
    const row = Buffer.alloc(stride);
    for (let x = 0; x < r.w; x++) {
      let c = r.px[y * r.w + x];
      if (c === T) c = background;
      const R = (c >> 16) & 255, G = (c >> 8) & 255, B = c & 255;
      for (let s = 0; s < scale; s++) {
        const o = 1 + (x * scale + s) * 3;
        row[o] = R; row[o + 1] = G; row[o + 2] = B;
      }
    }
    for (let s = 0; s < scale; s++) row.copy(raw, (y * scale + s) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

function encodeRGBA(r: Raster, scale: number): Buffer {
  const W = r.w * scale, H = r.h * scale;
  const stride = W * 4 + 1;
  const raw = Buffer.alloc(stride * H);
  for (let y = 0; y < r.h; y++) {
    const row = Buffer.alloc(stride);
    for (let x = 0; x < r.w; x++) {
      const c = r.px[y * r.w + x];
      if (c === T) continue;
      for (let s = 0; s < scale; s++) {
        const o = 1 + (x * scale + s) * 4;
        row[o] = (c >> 16) & 255; row[o + 1] = (c >> 8) & 255; row[o + 2] = c & 255; row[o + 3] = 255;
      }
    }
    for (let s = 0; s < scale; s++) row.copy(raw, (y * scale + s) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))]);
}

/** Multi-image .ico container holding PNG-compressed entries (supported by every browser since Vista-era ICO). */
export function encodeICO(images: ReadonlyArray<{ size: number; png: Buffer }>): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + i * 16;
    header[e] = size >= 256 ? 0 : size;
    header[e + 1] = size >= 256 ? 0 : size;
    header[e + 2] = 0; // palette colours
    header[e + 3] = 0; // reserved
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bpp
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}
