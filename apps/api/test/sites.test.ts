import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSignedEnvelope } from "@company/protocol";
import { harness, seat, worker, until, job, get, post, getWithHost } from "./helpers.ts";

test("sites: hosted on our storage at <label>.<SITES_DOMAIN>, served by Host header; names; ENS is off", async () => {
  const h = await harness();
  try {
    const s = await seat(h, 1);
    const w = await worker(h, s, { premium: true });
    const j = h.app.engine.admitJob({ objective: "A one-page site for the firm.", skill: "build-website", ipfs: "the-firm" }, { paidBy: s.account.address });
    const done = await until(() => job(h, j.id).state === "completed" && job(h, j.id), "site job");
    assert.equal(done.site.label, "the-firm");
    assert.equal(done.site.url, "https://the-firm.sites.test");
    const page = await getWithHost(h, "the-firm.sites.test", "/");
    assert.equal(page.status, 200);
    assert.match(page.headers["content-type"], /text\/html/);
    assert.match(page.body, /Filed\./);
    assert.equal((await getWithHost(h, "the-firm.sites.test:443", "/members/42")).status, 200, "SPA fallback for routes without an extension");
    assert.equal((await getWithHost(h, "the-firm.sites.test", "/missing.png")).status, 404);
    assert.equal((await getWithHost(h, "nobody.sites.test", "/")).status, 404);
    assert.equal((await getWithHost(h, "localhost", "/health")).status, 200, "other hosts reach the API");
    const sites = (await get(h, "/sites")).body;
    assert.equal(sites.live, 1);
    assert.equal(sites.sites[0].site.url, "https://the-firm.sites.test");
    assert.equal((await get(h, "/sites/by-label/the-firm")).body.jobId, j.id);
    assert.equal((await get(h, `/sites/${sites.sites[0].id}`)).body.label, "the-firm");
    const names = (await get(h, "/names")).body;
    assert.equal(names.names[0].name, "the-firm.sites.test");
    assert.equal((await get(h, "/names/the-firm")).body.siteId, sites.sites[0].id);
    const ens = await get(h, "/ens");
    assert.equal(ens.status, 404);
    assert.equal(ens.body.error, "feature_off");
    assert.equal((await get(h, "/ens/0xabc/0x1234")).body.error, "feature_off");

    // a second job asking for the same label from another payer gets a suffixed label
    const other = h.app.engine.admitJob({ objective: "Another site.", skill: "build-website", ipfs: "the-firm" }, { paidBy: "0x000000000000000000000000000000000000beef" });
    const od = await until(() => job(h, other.id).state === "completed" && job(h, other.id), "second site");
    assert.match(od.site.label, /^the-firm-[0-9a-f]{4}$/);
    await w.stop();
  } finally {
    await h.close();
  }
});

test("POST /sites/publish: device-signed, from the seat's own bundle, 10 per seat per day, labels are owned", async () => {
  const h = await harness();
  try {
    const s = await seat(h, 1);
    const w = await worker(h, s, { premium: true });
    const j = h.app.engine.admitJob({ objective: "A site.", skill: "build-website" }, { paidBy: null });
    await until(() => job(h, j.id).state === "completed", "job");
    const bundleHash = h.app.store.c<any>("submissions").all()[0].bundleHash;
    const publish = (label: string) => post(h, "/sites/publish", makeSignedEnvelope(s.key, "site.publish", { label, bundleHash }));
    const first = await publish("my-seat");
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.deepEqual(first.body.site, { label: "my-seat", url: "https://my-seat.sites.test" });
    assert.equal((await getWithHost(h, "my-seat.sites.test", "/")).status, 200);
    assert.equal((await publish("Bad_Label")).body.error, "invalid_label");
    for (let i = 2; i <= 10; i++) assert.equal((await publish(`my-seat-${i}`)).status, 201);
    const over = await publish("my-seat-11");
    assert.equal(over.status, 429);
    assert.equal(over.body.error, "publication_quota");
    assert.ok(Number(over.headers.get("retry-after")) > 0);
    const s2 = await seat(h, 2);
    const taken = await post(h, "/sites/publish", makeSignedEnvelope(s2.key, "site.publish", { label: "my-seat", bundleHash }));
    assert.equal(taken.status, 404, "another seat cannot publish this seat's bundle");
    await w.stop();
  } finally {
    await h.close();
  }
});
