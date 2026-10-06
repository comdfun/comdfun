import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodePNG, encodeICO, PNG_SIGNATURE, composeFigure, mark64, mark32, mark16, monoMark, logoMark,
  logoHorizontal, logoStacked, squareProfile, heroBanner, ogBanner, discordBanner, xHeader, favicon,
} from "../src/index.js";

const dims = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20), type: b[25] });

test("brand assets render to their exact published sizes", () => {
  const cases: [string, { r: { w: number; h: number }; unit: number }, number, number][] = [
    ["hero", heroBanner(), 1920, 1080],
    ["og", ogBanner(), 1200, 630],
    ["discord", discordBanner(), 960, 540],
    ["x", xHeader(), 1500, 500],
    ["profile", squareProfile(), 400, 400],
    ["horizontal", logoHorizontal(true), 2400, 600],
    ["stacked", logoStacked(), 1600, 1600],
  ];
  for (const [name, a, w, h] of cases) assert.deepEqual([a.r.w * a.unit, a.r.h * a.unit], [w, h], name);
  for (const s of [512, 1024, 2048]) assert.equal(Number.isInteger(s / mark64().w), true);
});

test("transparent PNGs are RGBA with real alpha; opaque ones are RGB", () => {
  const t = encodePNG(logoMark(), 8, null);
  assert.ok(t.subarray(0, 8).equals(PNG_SIGNATURE));
  assert.deepEqual(dims(t), { w: 512, h: 512, type: 6 });
  assert.equal(dims(encodePNG(favicon(32), 1)).type, 2);
});

test("favicon.ico container: header, entries, embedded PNGs", () => {
  const f16 = encodePNG(favicon(16), 1), f32 = encodePNG(favicon(32), 1);
  const ico = encodeICO([{ size: 16, png: f16 }, { size: 32, png: f32 }]);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 2);
  assert.equal(ico[6], 16);
  assert.equal(ico[22], 32);
  const off = ico.readUInt32LE(6 + 12), len = ico.readUInt32LE(6 + 8);
  assert.ok(ico.subarray(off, off + len).equals(f16));
  assert.ok(ico.subarray(ico.readUInt32LE(22 + 12), ico.readUInt32LE(22 + 12) + 8).equals(PNG_SIGNATURE));
});

test("marks and figures: sizes, determinism, mono knock-out", () => {
  assert.deepEqual([mark64().w, mark32().w, mark16().w], [64, 32, 16]);
  const m = monoMark(mark64());
  const colours = new Set(Array.from(m.px).filter((c) => c !== -1));
  assert.equal(colours.size, 1);
  const f = composeFigure(42);
  assert.deepEqual([f.w, f.h], [32, 49]);
  assert.deepEqual(Array.from(f.px), Array.from(composeFigure(42).px));
  assert.equal(f.get(0, 0), -1, "figure background is transparent");
});
