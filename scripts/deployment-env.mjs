#!/usr/bin/env node
// Print the api and web environment variables (Company.md) for a contracts deployment.
//
//   node scripts/deployment-env.mjs <chainId> [--deployments contracts/deployments] [--broadcast contracts/broadcast]
//          [--format env|json] [--only api|web]
//
// Reads contracts/deployments/<chainId>.json (written by script/Deploy.s.sol). NEXT_PUBLIC_INCORPORATIONS_FROM_BLOCK
// comes from the broadcast receipts (L2 block numbers); the JSON's deployedAtBlock is block.number inside the script,
// which on Arbitrum Orbit chains is the parent-chain block, so it is not used for log queries.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const chainId = args.find((a) => /^\d+$/.test(a));
if (!chainId) { console.error("usage: deployment-env.mjs <chainId> [--format env|json] [--only api|web]"); process.exit(2); }
const deploymentsDir = resolve(opt("deployments", join(root, "contracts", "deployments")));
const broadcastDir = resolve(opt("broadcast", join(root, "contracts", "broadcast")));
const format = opt("format", "env");
const only = opt("only", "");

const file = join(deploymentsDir, `${chainId}.json`);
if (!existsSync(file)) { console.error(`no deployment at ${file}`); process.exit(1); }
const d = JSON.parse(readFileSync(file, "utf8"));

let fromBlock = "0";
const run = join(broadcastDir, "Deploy.s.sol", String(chainId), "run-latest.json");
if (existsSync(run)) {
  const r = JSON.parse(readFileSync(run, "utf8"));
  const blocks = (r.receipts ?? []).map((x) => Number(BigInt(x.blockNumber))).filter((n) => Number.isFinite(n) && n >= 0);
  if (blocks.length) fromBlock = String(Math.min(...blocks));
}

const api = {
  CHAIN_ID: String(d.chainId ?? chainId),
  PERMIT2_ADDRESS: d.permit2,
  // x402 payTo: COMD received is split by RevenueRouter.distribute() (80% Counsel rewards / 20% firm treasury)
  PAYTO_ADDRESS: d.revenueRouter,
  TREASURY_ADDRESS: d.treasury,
  COUNSEL_NFT: d.counselNFT,
  // the payment asset ($COMD, 18 decimals)
  COMD_TOKEN: d.comdToken,
  IDENTITY_REGISTRY: d.identityRegistry,
  REPUTATION_REGISTRY: d.reputationRegistry,
  PROJECT_FACTORY: d.projectFactory,
  REWARD_DISTRIBUTOR: d.rewardDistributor,
  CONTRIBUTOR_DISTRIBUTOR: d.contributorDistributor,
  // the keeper loop (KEEPER_PRIVATE_KEY), GET /flywheel and /health
  REVENUE_ROUTER: d.revenueRouter,
  FLYWHEEL: d.flywheel,
  SWAPPER: d.swapper,
};
const web = {
  NEXT_PUBLIC_CHAIN_ID: String(d.chainId ?? chainId),
  NEXT_PUBLIC_COUNSEL_NFT: d.counselNFT,
  NEXT_PUBLIC_COMD_TOKEN: d.comdToken,
  NEXT_PUBLIC_SWAPPER: d.swapper,
  NEXT_PUBLIC_FLYWHEEL: d.flywheel,
  NEXT_PUBLIC_PERMIT2: d.permit2,
  NEXT_PUBLIC_INCORPORATIONS: d.incorporations,
  NEXT_PUBLIC_INCORPORATIONS_FROM_BLOCK: fromBlock,
  NEXT_PUBLIC_IDENTITY_REGISTRY: d.identityRegistry,
  NEXT_PUBLIC_REVENUE_ROUTER: d.revenueRouter,
  NEXT_PUBLIC_REWARD_DISTRIBUTOR: d.rewardDistributor,
  NEXT_PUBLIC_CONTRIBUTOR_DISTRIBUTOR: d.contributorDistributor,
};
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

if (format === "json") {
  console.log(JSON.stringify(only === "api" ? clean(api) : only === "web" ? clean(web) : { api: clean(api), web: clean(web) }, null, 2));
} else {
  const lines = (title, o) => [`# ${title} (chain ${chainId}, from ${file.replace(root + "/", "")})`, ...Object.entries(clean(o)).map(([k, v]) => `${k}=${v}`)].join("\n");
  const out = [];
  if (only !== "web") out.push(lines("api service", api));
  if (only !== "api") out.push(lines("web service (build-time; redeploy web after changing)", web));
  console.log(out.join("\n\n"));
}
