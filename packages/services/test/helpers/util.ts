import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.resolve(HERE, "..", "fixtures");
export const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");

// Foundry for the Clerk tests: FORGE_BIN / SOLC_BIN, else foundryup's and svm's default install locations.
export const FORGE_BIN = process.env.FORGE_BIN ?? path.join(os.homedir(), ".foundry", "bin", "forge");
export const SOLC_BIN = process.env.SOLC_BIN ?? path.join(os.homedir(), ".svm", "0.8.26", "solc-0.8.26");
export const HAVE_FOUNDRY = existsSync(FORGE_BIN) && existsSync(SOLC_BIN);

const cleanups: string[] = [];
export async function tempDir(prefix = "svc-test-"): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), prefix));
  cleanups.push(d);
  return d;
}
export async function cleanupAll(): Promise<void> {
  await Promise.all(cleanups.splice(0).map((d) => rm(d, { recursive: true, force: true })));
}

export async function writeTree(root: string, files: Record<string, string | Uint8Array>): Promise<string> {
  for (const [p, c] of Object.entries(files)) {
    const abs = path.join(root, p);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, c);
  }
  return root;
}

/** Copy the Foundry fixture into a temp dir, pointing foundry.toml at SOLC_BIN. */
export async function foundryFixture(): Promise<string> {
  const dir = path.join(await tempDir("svc-foundry-"), "project");
  await cp(path.join(FIXTURES, "foundry-ok"), dir, { recursive: true });
  const tomlPath = path.join(dir, "foundry.toml");
  const toml = await readFile(tomlPath, "utf8");
  await writeFile(tomlPath, toml.replace(/^solc = ".*"$/m, `solc = "${SOLC_BIN}"`));
  return dir;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/** A real (tiny) PNG: width x height, solid black, 8-bit RGB. */
export function makePng(width = 4, height = 4): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A real PCM WAV of `samples` silent 16-bit mono samples. */
export function makeWav(samples = 800): Buffer {
  const data = Buffer.alloc(samples * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(16000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Minimal ISO-BMFF (mp4) header: ftyp + an empty mdat. */
export function makeMp4(): Buffer {
  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write("ftypisom", 4, "ascii");
  ftyp.writeUInt32BE(0x200, 12);
  ftyp.write("isomiso2", 16, "ascii");
  const mdat = Buffer.alloc(64);
  mdat.writeUInt32BE(64, 0);
  mdat.write("mdat", 4, "ascii");
  return Buffer.concat([ftyp, mdat]);
}
