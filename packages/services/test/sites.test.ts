import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createBlobStore, publishSite, serveSite, siteContentCheck, SitePolicyError, getSiteManifest, readPointer, cacheControlFor } from "../src/index.ts";
import { cleanupAll, makePng, tempDir, writeTree } from "./helpers/util.ts";

after(cleanupAll);

async function site(files: Record<string, string | Uint8Array>) {
  return writeTree(path.join(await tempDir("svc-site-"), "dist"), files);
}

const goodSite = {
  "index.html": '<!doctype html><html><head><title>Docket</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Silkscreen"><script type="module" src="/assets/index-a1B2c3D4.js"></script></head><body>On the record.</body></html>',
  "assets/index-a1B2c3D4.js": 'console.log("filed");',
  "assets/logo.png": makePng(8, 8),
  "about/index.html": "<!doctype html><p>About the practice</p>",
  "robots.txt": "User-agent: *",
  "404.html": "<!doctype html><p>Not found. Overruled.</p>",
};

describe("site content screen", () => {
  test("a clean site passes", async () => {
    const r = await siteContentCheck(await site(goodSite));
    assert.equal(r.verdict, "pass", JSON.stringify(r.findings));
    assert.deepEqual(r.stats.externalHosts, ["fonts.googleapis.com"]);
  });

  test("drainer patterns, unknown script hosts and secret collection are blocked", async () => {
    const r = await siteContentCheck(
      await site({
        "index.html": `<!doctype html><script src="https://cdn.evil.example/drain.js"></script><input placeholder="Enter your seed phrase">`,
        "app.js": `const ok = await ethereum.request({ method: "eth_sign", params: [a, h] });\nnft.setApprovalForAll("0x000000000000000000000000000000000000dEaD", true);\nfetch("https://api.telegram.org/bot123/sendMessage")`,
      }),
    );
    assert.equal(r.verdict, "block");
    const rules = new Set(r.findings.map((f) => f.rule));
    for (const rule of ["external-script", "secret-collection", "raw-eth-sign", "hardcoded-approval-for-all", "telegram-exfiltration"]) assert.ok(rules.has(rule), `missing ${rule}: ${[...rules]}`);
    const sign = r.findings.find((f) => f.rule === "raw-eth-sign")!;
    assert.equal(sign.file, "app.js");
    assert.equal(sign.line, 1);
  });

  test("size limits, executables and missing index", async () => {
    const r = await siteContentCheck(await site({ "setup.exe": "MZ", "big.bin": Buffer.alloc(2048) }), { maxFileBytes: 1024 });
    const rules = r.findings.map((f) => f.rule);
    assert.ok(rules.includes("missing-index") && rules.includes("executable-download") && rules.includes("file-too-large"), rules.join(","));
    assert.equal(r.verdict, "block");
  });

  test("third-party iframe is a warning (review), not a block", async () => {
    const r = await siteContentCheck(await site({ "index.html": '<!doctype html><iframe src="https://www.youtube.com/embed/x"></iframe>' }));
    assert.equal(r.verdict, "review");
  });
});

describe("publishSite + serveSite", () => {
  test("publishes under sites/<label>/<version>/ with a manifest and serves it", async () => {
    const store = createBlobStore({ STORAGE_DIR: await tempDir("svc-store-") });
    const dist = await site(goodSite);
    const pub = await publishSite({ label: "docket", distDir: dist, store, sitesDomain: "sites.comd.fun" });
    assert.equal(pub.url, "https://docket.sites.comd.fun");
    assert.match(pub.version, /^[0-9a-f]{16}$/);
    assert.match(pub.manifestHash, /^[0-9a-f]{64}$/);
    assert.equal(pub.files, 6);
    assert.ok(await store.hasObject(`sites/docket/${pub.version}/files/index.html`));
    assert.ok(await store.has(pub.manifestHash), "manifest is also content-addressed");
    const manifest = await getSiteManifest(store, "docket");
    assert.equal(manifest?.files.find((f) => f.path === "assets/logo.png")?.mediaType, "image/png");

    // idempotent: same bytes -> same version
    const again = await publishSite({ label: "docket", distDir: dist, store });
    assert.equal(again.version, pub.version);
    assert.equal(again.manifestHash, pub.manifestHash);

    const root = await serveSite(store, "docket", "/");
    assert.equal(root.status, 200);
    assert.equal(root.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(root.headers["cache-control"], "public, max-age=0, must-revalidate");
    assert.match(root.body.toString(), /On the record/);

    const js = await serveSite(store, "docket", "/assets/index-a1B2c3D4.js?v=1");
    assert.equal(js.headers["content-type"], "text/javascript; charset=utf-8");
    assert.equal(js.headers["cache-control"], "public, max-age=31536000, immutable");

    const png = await serveSite(store, "docket", "/assets/logo.png");
    assert.equal(png.headers["content-type"], "image/png");
    assert.equal(png.headers["cache-control"], "public, max-age=300");
    assert.deepEqual(png.body.subarray(0, 4), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const about = await serveSite(store, "docket", "/about");
    assert.equal(about.status, 200);
    assert.match(about.body.toString(), /About the practice/);

    const spa = await serveSite(store, "docket", "/matters/2026-0412");
    assert.equal(spa.status, 200, "client-side route falls back to index.html");
    assert.match(spa.body.toString(), /On the record/);

    const missing = await serveSite(store, "docket", "/assets/missing.js");
    assert.equal(missing.status, 404);
    assert.match(missing.body.toString(), /Overruled/, "custom 404.html");

    const cached = await serveSite(store, "docket", "/", { ifNoneMatch: root.headers.etag });
    assert.equal(cached.status, 304);
    assert.equal(cached.body.length, 0);

    const head = await serveSite(store, "docket", "/", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);

    assert.equal((await serveSite(store, "docket", "/../../etc/passwd")).status, 200, "traversal is normalised inside the site (SPA fallback)");
    assert.equal((await serveSite(store, "nope", "/")).status, 404);
    assert.equal((await serveSite(store, "Bad_Label", "/")).status, 404);
    assert.equal((await serveSite(store, "docket", "/", { method: "POST" })).status, 405);
  });

  test("a new version becomes current and keeps a pointer to the previous one", async () => {
    const store = createBlobStore({ STORAGE_DIR: await tempDir("svc-store-") });
    const v1 = await publishSite({ label: "brief", distDir: await site({ "index.html": "<!doctype html>v1" }), store });
    const v2 = await publishSite({ label: "brief", distDir: await site({ "index.html": "<!doctype html>v2" }), store });
    assert.notEqual(v1.version, v2.version);
    const ptr = await readPointer(store, "brief");
    assert.equal(ptr?.version, v2.version);
    assert.equal(ptr?.previous, v1.version);
    const old = await serveSite(store, "brief", "/", { version: v1.version });
    assert.match(old.body.toString(), /v1/);
    const cur = await serveSite(store, "brief", "/", { pointerTtlMs: 0 });
    assert.match(cur.body.toString(), /v2/);
  });

  test("refuses invalid labels and blocked content", async () => {
    const store = createBlobStore({ STORAGE_DIR: await tempDir("svc-store-") });
    await assert.rejects(publishSite({ label: "-bad", distDir: await site(goodSite), store }), /invalid site label/);
    await assert.rejects(
      publishSite({ label: "phish", distDir: await site({ "index.html": '<!doctype html><script src="https://x.example/a.js"></script>' }), store }),
      (e: unknown) => e instanceof SitePolicyError && e.screen.verdict === "block",
    );
  });

  test("cache-control classes", () => {
    assert.equal(cacheControlFor("assets/app-3f9a1c2b.css"), "public, max-age=31536000, immutable");
    assert.equal(cacheControlFor("assets/app.css"), "public, max-age=300");
    assert.equal(cacheControlFor("index.html"), "public, max-age=0, must-revalidate");
  });
});
