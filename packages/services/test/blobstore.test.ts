import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createBlobStore, sha256Hex, signRequest, verifySignature } from "../src/index.ts";
import { startFakeS3, type FakeS3 } from "./helpers/fakeS3.ts";
import { cleanupAll, tempDir } from "./helpers/util.ts";

after(cleanupAll);

const creds = { accessKeyId: "AKIDTEST", secretAccessKey: "secret/with+chars" };

async function exerciseStore(store: ReturnType<typeof createBlobStore>) {
  const data = Buffer.from("In re: the matter of blob storage\n");
  const hash = sha256Hex(data);
  assert.equal(await store.has(hash), false);
  const put = await store.put(data, { mediaType: "text/plain" });
  assert.equal(put.hash, hash);
  assert.equal(put.bytes, data.length);
  assert.equal(put.created, true);
  assert.equal(put.key, `blobs/${hash.slice(0, 2)}/${hash}`);
  assert.equal(await store.has(hash), true);
  const again = await store.put(data);
  assert.equal(again.created, false, "put is idempotent");
  const got = await store.get(hash);
  assert.ok(got);
  assert.deepEqual(got.data, data);
  assert.equal(got.mediaType, "text/plain");
  assert.equal(await store.get("0".repeat(64)), null);
  await assert.rejects(store.get("not-a-hash"), /invalid sha256/);

  const obj = await store.putObject("sites/demo/v1/files/index.html", "<!doctype html><p>hi</p>", { mediaType: "text/html" });
  assert.equal(obj.hash, sha256Hex("<!doctype html><p>hi</p>"));
  const back = await store.getObject("sites/demo/v1/files/index.html");
  assert.equal(back?.data.toString(), "<!doctype html><p>hi</p>");
  assert.match(back!.mediaType, /^text\/html/);
  assert.equal(await store.hasObject("sites/demo/v1/files/missing.html"), false);
  await assert.rejects(store.putObject("../escape", "x"), /invalid object key/);
  await assert.rejects(store.putObject("a//b", "x"), /invalid object key/);
  return hash;
}

describe("blob store: local driver", () => {
  test("put/get/has/url and named objects", async () => {
    const dir = await tempDir();
    const store = createBlobStore({ STORAGE_DRIVER: "local", STORAGE_DIR: dir });
    assert.equal(store.driver, "local");
    const hash = await exerciseStore(store);
    assert.equal(store.url(hash), `file://${dir}/blobs/${hash.slice(0, 2)}/${hash}`);
    const withApi = createBlobStore({ STORAGE_DIR: dir, PUBLIC_API_URL: "https://api.example/" });
    assert.equal(withApi.url(hash), `https://api.example/blobs/${hash}`);
    assert.equal(await withApi.has(hash), true, "a second store over the same volume sees the blob");
  });

  test("detects corruption on get", async () => {
    const dir = await tempDir();
    const store = createBlobStore({ STORAGE_DIR: dir });
    const { hash } = await store.put("original");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`${dir}/blobs/${hash.slice(0, 2)}/${hash}`, "tampered");
    await assert.rejects(store.get(hash), /corrupt/);
  });
});

describe("blob store: S3 driver against an in-process fake S3", () => {
  let s3: FakeS3;
  after(() => s3?.close());

  test("SigV4 round-trip, put/get/has, public URLs, retry on 5xx", async () => {
    s3 = await startFakeS3(creds, { failFirstPut: true });
    const env = {
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: s3.url,
      S3_BUCKET: "comd-artifacts",
      S3_ACCESS_KEY_ID: creds.accessKeyId,
      S3_SECRET_ACCESS_KEY: creds.secretAccessKey,
      S3_PUBLIC_URL: "https://cdn.example/comd-artifacts",
    };
    const store = createBlobStore(env);
    assert.equal(store.driver, "s3");
    const hash = await exerciseStore(store);
    assert.ok(s3.requests.every((r) => r.signed), "every request carried a valid signature");
    assert.ok(s3.requests.some((r) => r.method === "PUT"));
    const stored = s3.objects.get(`/comd-artifacts/blobs/${hash.slice(0, 2)}/${hash}`);
    assert.ok(stored, "path-style key");
    assert.equal(stored.meta["x-amz-meta-sha256"], hash);
    assert.equal(store.url(hash), `https://cdn.example/comd-artifacts/blobs/${hash.slice(0, 2)}/${hash}`);

    const wrong = createBlobStore({ ...env, S3_SECRET_ACCESS_KEY: "nope" });
    await assert.rejects(wrong.put("x"), /HTTP 403/);
  });

  test("missing S3 env is a configuration error", () => {
    assert.throws(() => createBlobStore({ STORAGE_DRIVER: "s3", S3_BUCKET: "b" }), /S3_ENDPOINT is required/);
    assert.throws(() => createBlobStore({ STORAGE_DRIVER: "ipfs" }), /unknown STORAGE_DRIVER/);
  });

  test("signer is deterministic and verifiable", () => {
    const url = new URL("http://127.0.0.1:9000/bucket/blobs/ab/key%20with%20space?x-id=PutObject");
    const now = new Date("2026-10-05T12:00:00Z");
    const body = Buffer.from("payload");
    const h1 = signRequest({ method: "PUT", url, body, region: "auto", credentials: creds, now, headers: { "content-type": "text/plain" } });
    const h2 = signRequest({ method: "PUT", url, body, region: "auto", credentials: creds, now, headers: { "content-type": "text/plain" } });
    assert.equal(h1.authorization, h2.authorization);
    assert.match(h1.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDTEST\/20261005\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    assert.ok(verifySignature({ method: "PUT", url, body, credentials: creds, headers: { ...h1, host: url.host } }));
    assert.ok(!verifySignature({ method: "PUT", url, body: Buffer.from("other"), credentials: creds, headers: { ...h1, host: url.host } }));
  });
});
