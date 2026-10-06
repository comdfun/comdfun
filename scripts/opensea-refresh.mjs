#!/usr/bin/env node
// Ask OpenSea to re-read the metadata of every Counsel (traits + image), one item at a time.
//
//   OPENSEA_API_KEY=... node scripts/opensea-refresh.mjs [--collection counsel-362029053] [--from 1] [--to 2000] [--rps 2]
//
// ERC-4906 BatchMetadataUpdate (the "Refresh metadata on marketplaces" button on comd.fun/mint) is the cheap path and
// OpenSea honours it eventually; this is the deterministic one for when "eventually" is too slow. The chain slug and
// contract come from the collection itself, so nothing here needs editing when OpenSea renames a chain.
// Rate limit: OpenSea keys default to a few requests per second; --rps 2 stays well under it (2,000 items ≈ 17 min).
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const key = process.env.OPENSEA_API_KEY;
if (!key) { console.error("OPENSEA_API_KEY is required (https://docs.opensea.io/reference/api-keys)"); process.exit(2); }
const collection = opt("collection", "counsel-362029053");
const from = Number(opt("from", "1")), to = Number(opt("to", "2000")), rps = Number(opt("rps", "2"));
const H = { accept: "application/json", "x-api-key": key };

const col = await fetch(`https://api.opensea.io/api/v2/collections/${collection}`, { headers: H });
if (!col.ok) { console.error(`collection lookup failed: ${col.status} ${await col.text()}`); process.exit(1); }
const c = await col.json();
const contract = c.contracts?.[0];
if (!contract) { console.error("collection has no contract on OpenSea yet"); process.exit(1); }
console.log(`${c.name}: ${contract.address} on chain "${contract.chain}" · refreshing ${from}..${to} at ${rps}/s`);

let ok = 0, failed = 0;
const t0 = Date.now();
for (let id = from; id <= to; id++) {
  const started = Date.now();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetch(`https://api.opensea.io/api/v2/chain/${contract.chain}/contract/${contract.address}/nfts/${id}/refresh`, { method: "POST", headers: H });
    if (r.ok) { ok++; break; }
    if (r.status === 429 && attempt < 3) { await new Promise((res) => setTimeout(res, 2_000 * attempt)); continue; }
    failed++; console.error(`#${id}: ${r.status} ${(await r.text()).slice(0, 120)}`); break;
  }
  if (id % 100 === 0) console.log(`${id}/${to} · ok ${ok} · failed ${failed} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const wait = 1000 / rps - (Date.now() - started);
  if (wait > 0) await new Promise((res) => setTimeout(res, wait));
}
console.log(`done: ${ok} refreshed, ${failed} failed`);
process.exit(failed && !ok ? 1 : 0);
