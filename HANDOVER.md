# Handover — Company.md ($COMD)

Status 2026-10-06: V5, final for launch. **Company.md** / **$COMD** / **comd.fun**, inspired by IMD (imd.fun):
jobs paid in COMD; 100% of supply in our own pool, locked; a tax-only hook (5% ETH) feeding the Flywheel. No capped
pool, buy wall, staking or bond (owner decision). There are no stablecoin payments. The feature checklist
is [PARITY.md](PARITY.md); the spec is [SPEC.md](SPEC.md). Contracts are **unaudited**.

Re-run before any deploy: `npm test`, `npm run contracts:test`, `npm run e2e`, `npm run e2e:ui`,
`node skills/check-skill.mjs`.

## Decisions made

| Topic | Decision | Where it lives |
|---|---|---|
| Name and domain | Company.md, $COMD; `comd.fun`, `api.comd.fun`, `*.sites.comd.fun`; contact `team@comd.fun`; X `https://x.com/comdfun` | env defaults, DEPLOY.md §6 |
| Price per request | **100 COMD** (atomic `100000000000000000000`), configurable with `PRICE_COMD`; schedules per run | api env |
| Payment split | RevenueRouter: 80% of every COMD payment to Counsel rewards, 20% to the firm treasury (owner-settable, rewards 50–100%) | contracts |
| Token supply | 1,000,000,000 COMD, fixed, **100% in liquidity** (one locked single-sided position in the official COMD/ETH pool) | `ComdToken`, `SeedPool.s.sol` |
| Swap tax | **5% on every buy and sell, in ETH** → Flywheel; hard cap 5% | `ComdTaxHook` |
| Flywheel split | **50% buyback-and-burn / 50% Counsel floor sweeps** (2.5% / 2.5% of volume; owner-settable) | `Flywheel` |
| Removed (owner decision) | capped pool / trims, buy wall, sCOMD staking, bond | — |
| Seat rewards | COMD only: 80% of job revenue + the 1% Incorporations fee, by accepted work, weekly | `RewardDistributor` |
| Counsel mint | free (price 0), 2,000 seats, max 2 per wallet | `CounselNFT` |
| Premium models | Opus 5.5, Fable 5.1, GPT-6 Astra or GPT-6 class at high effort (`effort` high/xhigh/max); override with `PREMIUM_MODELS` | api |
| Planner | Managing Partner on the Anthropic API (`ANTHROPIC_MODEL`, default `claude-sonnet-5-5`) | api |
| GitHub | swarm output in org `comdfun`; worker releases in `comdfun/worker` (`comd-worker.tgz` + `SHA256SUMS`) | workflows, worker |
| Hosting | Railway: `web` + `api` (1 replica) + Postgres + volume `/data` | infra/, DEPLOY.md |

## What only you can do (in order)

1. **GitHub:** create the main repository and push this folder; create the org `comdfun` and the repo
   `comdfun/worker` (with one commit); add the Actions secret `WORKER_RELEASE_TOKEN`; create a fine-grained
   `GITHUB_TOKEN` for `comdfun`.
2. **Domain and email:** point `comd.fun`, `api.comd.fun` and `*.sites.comd.fun` at Railway (DEPLOY.md §6); set
   up the `team@comd.fun` mailbox with MX, SPF, DKIM and DMARC.
3. **Wallets/keys:** deployer, `ADMIN` multisig (Safe), POL wallet, settler, registrar (`DEPLOYER_PRIVATE_KEY` in
   api), attester, keeper — fund each with a little ETH on Robinhood Chain. Plus `ANTHROPIC_API_KEY`, a
   WalletConnect project id (allow-list `comd.fun`), the GitHub token.
4. **Choose the opening market cap** (`INITIAL_MARKET_CAP_WEI`, default 10 ETH for all 1B COMD) and, if you want floor sweeps on mainnet, the marketplace
   (`SEAPORT`, plus a listings feed for `SWEEP_LISTINGS_URL`).
   For a GitHub deploy: add the secrets `DEPLOYER_PRIVATE_KEY`, `POL_PRIVATE_KEY`, `RPC_URL_MAINNET`,
   `RPC_URL_TESTNET` and the variables `ADMIN`, `POL`, `TREASURY`, `KEEPER`, `SETTLER`, `REGISTRAR`, `ATTESTER`;
   add required reviewers to the `mainnet` environment.
5. **Rehearse on testnet 46630**, then **outside audit**, then mainnet in this order (DEPLOY.md §2):
   1. deploy and seed: *Actions → deploy-contracts* (network `mainnet`, confirm `deploy mainnet`) — it checks the
      external addresses, runs `Deploy.s.sol`, then `SeedPool.s.sol` (100% of COMD in one transaction —
      irreversible) and prints the Railway variables; or from a laptop with `npm run contracts:deploy:mainnet` and
      `SeedPool.s.sol` (DEPLOY.md §3, §7). Then `ADMIN` accepts ownership of `ComdTaxHook` and `Flywheel`, and you
      commit `contracts/deployments/4663.json` + `npm run contracts:abi`;
   2. check the pool: a small buy through the Swap page pays 5% to the Flywheel;
   3. open the free Counsel mint (allowlist and/or public);
   4. set the Railway variables (`node scripts/deployment-env.mjs 4663`) and deploy `api` (with the keeper key) and
      `web`; check `https://api.comd.fun/health`;
   5. release the worker (`git tag worker-v0.1.0 && git push origin worker-v0.1.0`).
6. **After launch:** watch the keeper (`GET /health`, `GET /services`), review sweep candidates before any floor
   sweep, decide what to do with swept Counsel (`awardSwept`), and consider renouncing owner powers you no longer need (contracts/README.md lists them).
7. **License:** there is no LICENSE file. The README says "All rights reserved" except the Solidity sources, which carry SPDX MIT headers (vendored libraries keep their own licenses). Add a LICENSE if you want to open the rest.

## Strongly recommended before significant TVL

An external audit of the contracts (see contracts/SECURITY_REVIEW.md: threat model, residual risks, owner powers).
The liquidity cannot be withdrawn or migrated once seeded.

## Where things are

README.md (map), SPEC.md, PARITY.md, INTERFACES.md, DEPLOY.md, contracts/README.md, apps/api/README.md,
apps/worker/README.md, packages/services/README.md, skills/README.md, e2e/.
