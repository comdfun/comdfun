import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderCounsel, renderCard, renderCounselPNG, renderCardPNG, metadata, traitTable, comboKey, attributesOf,
  PRACTICES, HEADWEAR, SKINS, EYES, ATTIRE, NECKWEAR, HELD, BACKDROPS, MAX_SUPPLY, icons, logoSvg, wordmarkSvg,
  REGISTRATION_TYPE, PNG_SIGNATURE,
} from "../src/index.js";

test("determinism: same id → identical svg, attributes and png", () => {
  for (const id of [1, 2, 42, 777, 2000]) {
    const a = renderCounsel(id), b = renderCounsel(id);
    assert.equal(a.svg, b.svg);
    assert.deepEqual(a.attributes, b.attributes);
    assert.equal(a.name, `Counsel #${String(id).padStart(4, "0")}`);
    assert.ok(renderCounselPNG(id, 4).equals(renderCounselPNG(id, 4)));
    assert.equal(renderCard(id).svg, renderCard(id).svg);
  }
  assert.notEqual(renderCounsel(41).svg, renderCounsel(42).svg);
});

test("svg format: 32×32 viewBox, crispEdges, rect runs, size attribute", () => {
  const { svg } = renderCounsel(42, { size: 640 });
  assert.match(svg, /viewBox="0 0 32 32"/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /width="640" height="640"/);
  assert.match(svg, /<rect x="\d+" y="\d+" width="\d+" height="1"\/>/);
  assert.ok(!/NaN|undefined/.test(svg));
  assert.match(renderCard(42).svg, /viewBox="0 0 64 80"/);
});

test("uniqueness: no two of the 2,000 share a trait combination", () => {
  const t = traitTable();
  assert.equal(t.length, MAX_SUPPLY);
  assert.equal(new Set(t.map(comboKey)).size, MAX_SUPPLY);
});

test("every trait value is reachable", () => {
  const t = traitTable();
  const check = (name: string, all: readonly string[], got: (x: (typeof t)[number]) => string) => {
    const seen = new Set(t.map(got));
    for (const v of all) assert.ok(seen.has(v), `${name}: ${v} never rolled`);
  };
  check("practice", PRACTICES, (x) => x.practice);
  check("headwear", HEADWEAR, (x) => x.headwear);
  check("skin", SKINS, (x) => x.skin);
  check("eyes", EYES, (x) => x.eyes);
  check("attire", ATTIRE, (x) => x.attire);
  check("neckwear", NECKWEAR, (x) => x.neckwear);
  check("held", HELD, (x) => x.held);
  check("backdrop", BACKDROPS, (x) => x.backdrop);
  const chambers = new Set(Array.from({ length: MAX_SUPPLY }, (_, i) => attributesOf(i + 1).find((a) => a.trait_type === "Chambers")!.value));
  assert.equal(chambers.size, 20);
  assert.ok(chambers.has("Chambers I") && chambers.has("Chambers XX"));
});

test("founding partners #1–#10 are flagged and unique", () => {
  const t = traitTable();
  for (let id = 1; id <= 10; id++) assert.ok(t[id - 1].founder, `#${id} should be a Founding Partner`);
  assert.ok(t.slice(10).every((x) => !x.founder));
  assert.equal(new Set(t.slice(0, 10).map((x) => x.founder!.scheme)).size, 10);
});

function pngDims(buf: Buffer) {
  assert.ok(buf.subarray(0, 8).equals(PNG_SIGNATURE), "PNG signature");
  assert.equal(buf.subarray(12, 16).toString("ascii"), "IHDR");
  assert.equal(buf.subarray(buf.length - 8, buf.length - 4).toString("ascii"), "IEND");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test("png validity: signature, IHDR dimensions", () => {
  assert.deepEqual(pngDims(renderCounselPNG(7, 1)), { w: 32, h: 32 });
  assert.deepEqual(pngDims(renderCounselPNG(7, 10)), { w: 320, h: 320 });
  assert.deepEqual(pngDims(renderCardPNG(7, 8)), { w: 512, h: 640 });
});

test("invalid token ids throw", () => {
  for (const bad of [0, -1, 2001, 1.5, NaN]) assert.throws(() => renderCounsel(bad), RangeError);
});

test("metadata: ERC-8004 registration-v1 shape", () => {
  const base = { apiUrl: "https://api.example/", webUrl: "https://web.example", chainId: 4663, tokenContract: "0xC0FFEE0000000000000000000000000000000001" };
  const m = metadata(42, base);
  assert.equal(m.type, REGISTRATION_TYPE);
  assert.equal(m.type, "https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
  assert.equal(m.name, "Counsel #0042");
  assert.equal(m.image, "https://api.example/agents/by-token/42.png");
  assert.deepEqual(m.services, [{ name: "web", endpoint: "https://web.example/agents/42" }]);
  assert.equal(m.active, true);
  assert.equal(m.x402Support, false);
  assert.deepEqual(m.supportedTrust, ["reputation"]);
  assert.equal(m.enrolled, false);
  assert.deepEqual(m.registrations, []);
  assert.match(m.description, /Solidity/);
  assert.ok(m.attributes.some((a) => a.trait_type === "Chambers" && a.value === "Chambers I"));
  assert.equal(m.attributes.filter((a) => ["Practice", "Headwear", "Skin", "Eyes", "Attire", "Neckwear", "Held", "Backdrop", "Chambers"].includes(a.trait_type)).length, 9);

  const e = metadata(42, { ...base, agentId: 7, agentRegistry: "0x1111111111111111111111111111111111111111" });
  assert.equal(e.enrolled, true);
  assert.deepEqual(e.registrations, [{
    agentId: 7, agentRegistry: "eip155:4663:0x1111111111111111111111111111111111111111", chainId: 4663,
    tokenContract: base.tokenContract, tokenId: 42,
  }]);
  assert.ok(metadata(1, base).attributes.some((a) => a.trait_type === "Founding Partner"));
});

test("brand: logo, wordmark and all required icons", () => {
  assert.match(logoSvg(), /viewBox="0 0 32 32"/);
  assert.match(wordmarkSvg(), /shape-rendering="crispEdges"/);
  const required = ["scales", "gavel", "column", "quill", "seal", "briefcase", "clock", "document", "eye", "coin", "chain",
    "image", "audio", "video", "report", "audit", "website", "hook", "token", "contracts", "heartbeat", "oracle", "company"];
  for (const k of required) {
    const svg = (icons as Record<string, string>)[k];
    assert.ok(svg, `icon ${k}`);
    assert.match(svg, /viewBox="0 0 16 16"/);
    assert.match(svg, /fill="currentColor"/);
  }
});

test("metadata defaults: comd.fun URLs, Company.md copy, collection document", async () => {
  const { collectionMetadata, COLLECTION_NAME } = await import("../src/index.js");
  const m = metadata(42, { chainId: 4663, tokenContract: "0x0000000000000000000000000000000000000001" });
  assert.equal(m.image, "https://api.comd.fun/agents/by-token/42.png");
  assert.equal(m.external_url, "https://comd.fun/agents/42");
  assert.deepEqual(m.services, [{ name: "web", endpoint: "https://comd.fun/agents/42" }]);
  assert.match(m.description, /Company\.md/);
  assert.ok(!/The Company|\$COMPANY/.test(m.description));
  const c = collectionMetadata();
  assert.equal(c.name, "Counsel");
  assert.equal(COLLECTION_NAME, "Counsel");
  assert.equal(c.external_link, "https://comd.fun");
});

test("descriptions open with the positioning line", () => {
  const m = metadata(7, { chainId: 4663, tokenContract: "0x0000000000000000000000000000000000000001" });
  assert.ok(m.description.startsWith("Company.md is a swarm of NFT-identified agents that work together to perform AI tasks on chain."));
});
