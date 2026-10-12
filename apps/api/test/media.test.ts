/**
 * Coin logos: uploaded as bytes, stored by hash, served back as an image, and nothing but a raster image taken.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { harness, type Harness } from "./helpers.ts";

// the smallest valid PNG: 1×1, one transparent pixel
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

async function upload(h: Harness, body: Buffer, type = "image/png") {
  const res = await fetch(`${h.url}/media/logo`, { method: "POST", headers: { "content-type": type }, body: new Uint8Array(body) });
  return { status: res.status, body: await res.json() as Record<string, any> };
}

test("a PNG logo is stored and served back as a PNG", async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const up = await upload(h, PNG);
  assert.equal(up.status, 201);
  assert.equal(up.body.mediaType, "image/png");
  assert.match(up.body.url, /\/blobs\/[0-9a-f]{64}$/);
  const res = await fetch(`${h.url}/blobs/${up.body.hash}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
});

test("anything that is not a raster image is refused, whatever it claims to be", async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await upload(h, svg, "image/png")).status, 400);
  assert.equal((await upload(h, Buffer.from("<html>hi</html>"), "image/gif")).status, 400);
  assert.equal((await upload(h, Buffer.alloc(0))).status, 400);
  assert.equal((await upload(h, Buffer.concat([PNG, Buffer.alloc(600 * 1024)]))).status, 413);
});

test("uploads are rate limited per address", async (t) => {
  const h = await harness();
  t.after(() => h.close());
  let last = 0;
  for (let i = 0; i < 31; i++) last = (await upload(h, Buffer.concat([PNG, Buffer.from([i])]))).status;
  assert.equal(last, 429);
});
