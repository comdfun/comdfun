# Deploying Company.md on Railway (comd.fun)

> **UNAUDITED — EXPERIMENTAL.** No contract in `contracts/` has been audited by an outside firm. Rehearse everything
> on Robinhood Chain **testnet (46630)** first; deploy to **mainnet (4663)** only after an outside audit. The COMD
> liquidity is locked forever: there is no undo after the pool is seeded. Not affiliated with Robinhood.

This guide takes the repo from zero to: contracts on chain, 100% of $COMD seeded into the official COMD/ETH pool,
**Chambers** (the control plane, `apps/api`) and the **website** (`apps/web`) on Railway with Postgres, durable
storage, the `comd.fun` domains and hosted sites at `*.sites.comd.fun`, plus the `comd` worker CLI on GitHub
Releases (`comd-fun/worker`).

```
                      ┌──────────────────────── Railway project "comd" ──────────────────────────────┐
  comd.fun         ──▶│  web   infra/docker/web.Dockerfile   Next.js standalone (PORT)               │
                      │                                                                              │
  api.comd.fun     ──▶│  api   infra/docker/api.Dockerfile   Chambers: HTTP + WS /agent, scheduler,  │
  *.sites.comd.fun ──▶│        attester, settler, keeper, Clerk / Records Office / Registrar         │
                      │        (git + Foundry)  volume /data (STORAGE_DRIVER=local) — or a bucket    │
                      │                                                                              │
                      │  Postgres (Railway database)  ◀── DATABASE_URL                               │
                      └──────────────────────────────────────────────────────────────────────────────┘
  Robinhood Chain RPC ◀── api (viem, keeper), web (wallets)     GitHub org comd-filings ◀── Records Office
  Seats' machines: `comd` CLI ──WSS──▶ api.comd.fun/agent        GitHub comd-fun/worker ◀── release-worker
```

There are exactly two Railway services built from this repo. Everything the SPEC calls "services" (Clerk,
Records Office, Registrar, attester, scheduler, settler, keeper) runs **inside the api process**
(`apps/api/src/main.ts` → `App.create` → `loadServices()` wires `@company/services` in-process). So:

- run **exactly one replica** of `api` (the scheduler, lease timers, epoch settlement, the keeper and the volume
  are single-writer; `infra/railway/api.json` pins `numReplicas: 1`);
- the api image carries git, Foundry 1.7.1 (`forge`/`cast`/`anvil`) and solc 0.8.26 pre-fetched into
  `~/.svm/0.8.26/solc-0.8.26`, so Clerk re-runs work offline.

Contents

1. [Accounts, wallets and secrets](#1-accounts-wallets-and-secrets)
2. [Launch order](#2-launch-order)
3. [Contracts](#3-contracts)
4. [Railway project](#4-railway-project)
5. [Environment variables](#5-environment-variables)
6. [Domains and email](#6-domains-and-email)
7. [Open the market: seed 100% of COMD](#7-open-the-market-seed-100-of-comd)
8. [Counsel mint (free)](#8-counsel-mint-free)
9. [Mainnet checklist (4663)](#9-mainnet-checklist-4663)
10. [Releasing the worker CLI](#10-releasing-the-worker-cli)
11. [Operations: keeper, flywheel, backups](#11-operations-keeper-flywheel-backups)
12. [Local and CI equivalents](#12-local-and-ci-equivalents)

---------------------------------------------------------------------------------------------------------------

## 1. Accounts, wallets and secrets

| What | Why | Notes |
|---|---|---|
| Railway account (Hobby or Pro) | hosting | Volumes, Postgres and wildcard custom domains are needed. |
| GitHub repo for this monorepo | Railway deploys from it; CI | Connect the Railway GitHub app to it. |
| GitHub org `comd-filings` | Records Office pushes matter repos / PRs | Fine-grained token: *Administration: write* (create repos), *Contents: write*, *Pull requests: write* on that org → `GITHUB_TOKEN`. |
| GitHub repo `comd-fun/worker` | public releases of the `comd` CLI | Must have at least one commit. Named in `apps/worker/package.json` → `comdWorker.releasesRepo`. Token with *Contents: write* on it → repo secret `WORKER_RELEASE_TOKEN`. |
| Domain `comd.fun` with DNS you control | `comd.fun`, `api.comd.fun`, `*.sites.comd.fun`, mail for `team@comd.fun` | Any DNS host; Railway shows the exact records. |
| Mailbox `team@comd.fun` | public contact (site footer, `/health`, `/version`, release notes) | Any mail provider; see §6. |
| Anthropic API key | Managing Partner planning (`ORCHESTRATOR_RUNTIME=anthropic-api`) | `ANTHROPIC_API_KEY`. |
| WalletConnect / Reown project id | wallet connect on the site | `NEXT_PUBLIC_WC_PROJECT_ID`; allow-list `comd.fun` in the Reown dashboard. |
| Robinhood Chain RPC | api + web | Public: `https://rpc.testnet.chain.robinhood.com`, `https://rpc.mainnet.chain.robinhood.com`. A paid RPC is better for the api. |

Wallets (generate fresh keys; never reuse the anvil dev keys from `scripts/local-stack.sh`):

| Role (Deploy.s.sol env) | Key goes to | Holds / does |
|---|---|---|
| deployer (`DEPLOYER_PRIVATE_KEY` for the forge script) | your laptop only | Pays deploy gas; holds nothing and owns nothing afterwards. |
| `ADMIN` | **multisig** (Safe, ideally + timelock) on mainnet | Owner/admin of every contract: mint phase; hook tax bps (≤ 5%), cap/trim params and split destinations; BuyWall params; Flywheel bps, sweep price cap, adapters, `awardSwept`; sCOMD pause; dripper params; Bond enable/price/treasury; RevenueRouter bps (rewards 50–100%). Must `acceptOwnership()` on `ComdTaxHook` and `Flywheel`. |
| `POL` (alias `POL_WALLET`; `POL_PRIVATE_KEY` for SeedPool) | your laptop only | Receives **100%** of the 1,000,000,000 COMD at deploy and seeds all of it into the pool once (§7). Holds nothing afterwards. |
| `SETTLER` | api `SETTLER_PRIVATE_KEY` | Permit2 settlements, ERC-8004 feedback, `RewardDistributor.postRoot` (SETTLER_ROLE). Keep ~0.05 ETH. Must not own any Counsel. |
| `REGISTRAR` | api `DEPLOYER_PRIVATE_KEY` | The Registrar's forge-script deployer for swarm launches (REGISTRAR_ROLE on `ProjectFactory`). **Not** the contracts deployer. Keep ETH for launch gas. |
| attester | api `ATTESTER_PRIVATE_KEY` | Signs EIP-712 oracle attestations (domain "Company.md Oracle"); no funds needed. Publish its address. |
| `KEEPER` | api `KEEPER_PRIVATE_KEY` | `Flywheel.keeper()`: `buyback(minOut)`, `sweep(...)`; also the permissionless `BuyWall.rebalance()` (earns the capped tip), `RewardDripper.drip()`, `ComdTaxHook.flush()`, `RevenueRouter.distribute()`. Keep ~0.05 ETH. |
| `TREASURY` | cold / multisig | Company.md's treasury: 20% of job revenue (RevenueRouter), Bond ETH proceeds, Counsel royalties (ERC-2981 5%), launch policy owner. |
| `ATTESTER` (address) | GitHub variable | Recorded in the deploy job summary; its key is the api's `ATTESTER_PRIVATE_KEY`. |

## 2. Launch order

Rehearse the whole sequence on testnet 46630 first (same commands, testnet RPC), then on mainnet:

1. **Deploy the contracts** (§3; from GitHub Actions or a laptop) → `contracts/deployments/<chainId>.json`,
   regenerated `packages/abi`, commit. `ADMIN` accepts ownership of `ComdTaxHook` and `Flywheel`.
2. **Seed 100% of COMD into the COMD/ETH pool, atomically** (§7): one `initializeAndSeed` transaction from the POL
   wallet initializes the pool and deposits the whole supply. Swaps are impossible before it. The GitHub workflow
   runs steps 1 and 2 in one job.
3. **Open the free Counsel mint** (§8): phase allowlist and/or public, price 0.
4. **Start api and keeper** (§4–§5, §11): set the variables (`node scripts/deployment-env.mjs <chainId>` prints the
   addresses), deploy `api` with `KEEPER_PRIVATE_KEY`, then `web`. Check `https://api.comd.fun/health`.
   Counsel `tokenURI` points at the api (`/agents/by-token/<id>.json`): bring `api` up (without the keeper key if
   you like) before or right after opening the mint so metadata resolves for the first minters.
5. **Release the worker** (§10): tag `worker-v<version>`; seats install `comd` and pair.
6. Later, when you choose: enable the Bond (`Bond.setEnabled(true)` from `ADMIN`, after checking `priceEth`).

## 3. Contracts

Requirements: Foundry 1.7.1 (`foundryup -i v1.7.1`, or `npm i -g @foundry-rs/forge@1.7.1 @foundry-rs/cast@1.7.1`).

```bash
npm ci
npm run contracts:libs                # scripts/install-contract-libs.sh — pinned libs into contracts/lib
npm run contracts:test                # forge test

export DEPLOYER_PRIVATE_KEY=0x…       # funded with ETH on the target chain
export ADMIN=0x… POL=0x… TREASURY=0x… SETTLER=0x… KEEPER=0x… REGISTRAR=0x…
export COUNSEL_BASE_URI=https://api.comd.fun/agents/by-token/     # the default
# optional: BOND_PRICE_WEI (wei per 1 COMD, default 1e10 = the 10 ETH opening cap price), SEAPORT=0x… (deploys +
# allowlists a SeaportAdapter for floor sweeps), MAX_SWEEP_PRICE=<wei> (0.5 ETH)
# testnet: POOL_MANAGER unset → a v4 PoolManager and a MockMarketplace are deployed
DRY_RUN=1 npm run contracts:deploy:testnet   # simulate against the live chain first
npm run contracts:deploy:testnet             # scripts/deploy-contracts.sh testnet  (mainnet: …:mainnet)
```

`scripts/deploy-contracts.sh` checks the RPC's chain id, runs `forge script script/Deploy.s.sol:Deploy --broadcast
--slow`, regenerates `@company/abi` (`packages/abi/src/addresses.ts` + ABIs) and prints the Railway variables for
both services. The deployment JSON has, among others, `comdToken`, `comdTaxHook`, `comdRouter`, `flywheel`,
`revenueRouter`, `rewardDistributor`, `counselNFT`, `incorporations`, `projectFactory`, `identityRegistry`.
Add explorer verification with `FORGE_ARGS="--verify --verifier blockscout --verifier-url <blockscout>/api/"`.
Then commit `contracts/deployments/<chainId>.json` and `packages/abi/`.

After the deploy, from `ADMIN` (on mainnet: Safe transactions):

```bash
cast send <flywheel>    "acceptOwnership()" --rpc-url $RPC_URL …
cast send <comdTaxHook> "acceptOwnership()" --rpc-url $RPC_URL …
```

Sanity checks: `ComdTaxHook` address `& 0x3fff == 0x18CC`, `LaunchGuardHook & 0x3fff == 0x2000`;
`ComdToken.balanceOf(POL) == 1e27`; `Flywheel.keeper() == KEEPER`; `Bond.enabled() == false`.

### Deploy from GitHub Actions

`.github/workflows/deploy-contracts.yml` (*Actions → deploy-contracts → Run workflow*) does §3 and §7 in one job on
a GitHub runner, for when your machine cannot reach the RPC:

| Setting | Kind | Value |
|---|---|---|
| `DEPLOYER_PRIVATE_KEY` | secret | funded deployer key |
| `POL_PRIVATE_KEY` | secret | the POL wallet's key (must match the `POL` variable) |
| `RPC_URL_MAINNET`, `RPC_URL_TESTNET` | secrets | RPC endpoints (public defaults are used when unset) |
| `ADMIN`, `POL`, `TREASURY`, `KEEPER`, `SETTLER`, `REGISTRAR`, `ATTESTER` | variables | role addresses (all required on mainnet; `ADMIN` ≠ deployer) |
| `BOND_PRICE_WEI`, `MAX_SWEEP_PRICE`, `SEAPORT`, `COUNSEL_BASE_URI` | variables (optional) | as above |

Inputs: `network` (testnet | mainnet), `initial_market_cap_wei` (default 10 ETH), `dry_run` (simulate, no
broadcast, no seed), `seed_pool` (default on), `confirm` (must be `deploy mainnet` for mainnet). The job runs in the
GitHub environment named after the network, so required reviewers on `mainnet` give you an approval gate (and
secrets/variables can be scoped per environment). It checks the RPC chain id, the role addresses, that the POL key
matches `POL`, runs `scripts/check-mainnet-addresses.sh` on mainnet, `scripts/install-contract-libs.sh`,
`Deploy.s.sol` (JSON taken from the `DEPLOYMENTS_JSON_BEGIN/END` block), hook-flag and supply checks,
`SeedPool.s.sol` (`SEED_JSON_BEGIN/END`), then uploads `deployments/<chainId>.json`, the seed JSON, logs and
broadcast receipts as the `deployments-<network>-<run>` artifact and writes the Railway env block
(`scripts/deployment-env.mjs`) to the job summary. Afterwards: `ADMIN` accepts ownership, commit the JSON
(`contracts/deployments/<chainId>.json`) and run `npm run contracts:abi`.

## 4. Railway project

1. **New project** → *Deploy from GitHub repo* → this repo. Create a second service from the same repo
   (*New → GitHub Repo*). Name them `api` and `web`.
2. For each service: *Settings → Config-as-code → Railway config file*:
   - `api` → `infra/railway/api.json` (Dockerfile `infra/docker/api.Dockerfile`, healthcheck `/health`, restart on
     failure, 1 replica, watch paths for api/packages/skills)
   - `web` → `infra/railway/web.json` (Dockerfile `infra/docker/web.Dockerfile`, healthcheck `/`)
   Leave *Root directory* empty (the build context is the repo root; `.dockerignore` keeps it small).
3. **Postgres:** *New → Database → PostgreSQL*. On `api` add `DATABASE_URL=${{Postgres.DATABASE_URL}}` (reference
   variable; private network). The api applies `apps/api/migrations/*.sql` on start
   (`infra/docker/api-entrypoint.sh` runs `migrate.js` before the server; idempotent via `schema_migrations`).
4. **Storage — pick one:**
   - **Volume (default):** `api` → *Settings → Volumes → New volume*, mount path **`/data`**. The image defaults to
     `STORAGE_DRIVER=local`, `STORAGE_DIR=/data/storage`; the entrypoint refuses to start if it is not writable.
     Publishing and serving are both in `api`, so one volume is enough. Services with a volume redeploy with a few
     seconds of downtime.
   - **Bucket:** Railway *Bucket* (or Cloudflare R2 / any S3): `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_BUCKET`,
     `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` (`auto` for R2), `S3_PUBLIC_URL` if the bucket has a
     public domain; else keep `BLOB_PUBLIC_URL=https://api.comd.fun/artifacts` (the default) so the api serves the
     bytes.
   No Pinata / IPFS anywhere.
5. Set the variables of §5, then **deploy** `api` first, then `web`.
6. Check: `curl https://api.comd.fun/health` → `status` and the `degraded` list (empty when fully configured;
   `payments_mock`, `attester_ephemeral_key`, `chain_not_configured`, `keeper_off`… name what is missing).

## 5. Environment variables

`🔒` = secret (mark *sealed* in Railway; never commit). Names are the binding ones from `INTERFACES.md`,
`apps/api/.env.example` and `apps/web/.env.example`. Contract addresses come from
`node scripts/deployment-env.mjs <chainId>` (or set `DEPLOYMENTS_FILE` on the api).

### api

| Variable | 🔒 | Production value / default | Notes |
|---|---|---|---|
| `PORT` | | set by Railway | listen port (image default 8787) |
| `HOST` | | `0.0.0.0` (image default) | |
| `NODE_ENV` | | `production` (image default) | production defaults `PAYMENTS_MODE` to off |
| `TRUST_PROXY` | | `true` | per-IP rate limits behind Railway's proxy |
| `CHAIN_ID` | | `4663` (testnet `46630`) | payment + identity chain |
| `RPC_URL` | 🔒 if it embeds a key | `https://rpc.mainnet.chain.robinhood.com` | |
| `RPC_URL_<chainId>` | 🔒 | | extra chains for oracle questions / launches |
| `LAUNCH_CHAINS` | | `4663` | chains offered to launches/workflows (first = default) |
| `PUBLIC_API_URL` | | `https://api.comd.fun` | production default |
| `PUBLIC_WEB_URL` | | `https://comd.fun` | production default |
| `SITES_DOMAIN` | | `sites.comd.fun` | hosted sites at `https://<label>.sites.comd.fun` |
| `ALLOWED_ORIGINS` | | `https://comd.fun` | browser origins allowed on paid routes |
| `CONTACT_EMAIL` | | `team@comd.fun` | shown in `/version`, `/health` and HTML pages |
| `DATABASE_URL` | 🔒 | `${{Postgres.DATABASE_URL}}` | unset = in-memory (nothing survives a restart) |
| `STORAGE_DRIVER` | | `local` (image default) / `s3` | |
| `STORAGE_DIR` | | `/data/storage` (image default) | on the volume |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_PUBLIC_URL` | | | bucket mode |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | 🔒 | | bucket mode |
| `BLOB_PUBLIC_URL` | | `https://api.comd.fun/artifacts` (default) | public URL base for blobs |
| `ATTESTER_PRIVATE_KEY` | 🔒 | | oracle attestations; unset = ephemeral key (degraded) |
| `SETTLER_PRIVATE_KEY` | 🔒 | | = `SETTLER` wallet |
| `DEPLOYER_PRIVATE_KEY` | 🔒 | | = `REGISTRAR` wallet (launches); never passed to Clerk sandboxes |
| `KEEPER_PRIVATE_KEY` | 🔒 | | = `KEEPER` wallet; unset = keeper off (§11) |
| `GITHUB_TOKEN` | 🔒 | | Records Office; unset = dry-run publication |
| `GITHUB_ORG` | | `comd-filings` | |
| `PAYTO_ADDRESS` | | `revenueRouter` | x402 `payTo` (default `REVENUE_ROUTER`) |
| `PERMIT2_ADDRESS` | | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | must have code on the chain (§9) |
| `PRICE_COMD` | | `100000000000000000000` (100 COMD) | atomic (18 dp) per action; per run for schedules |
| `ENABLED_ACTIONS` | | all seven | comma list |
| `PAYMENTS_MODE` | | unset (`off` in production) | `mock` = accept signed payments without moving funds (dev only) |
| `SETTLE_WAIT_MS`, `REQUESTS_PER_MINUTE`, `QUOTES_PER_MINUTE`, `READS_PER_MINUTE` | | `25000`, `300`, `30`, `120` | |
| `COMD_TOKEN` | | `comdToken` | the payment asset |
| `FLYWHEEL`, `COMD_ROUTER`, `COMD_TAX_HOOK`, `BUY_WALL`, `STAKED_COMD`, `REWARD_DRIPPER`, `BOND`, `REVENUE_ROUTER` | | from the deployment | keeper, `GET /flywheel`, vault pages |
| `COUNSEL_NFT`, `IDENTITY_REGISTRY`, `REPUTATION_REGISTRY`, `PROJECT_FACTORY`, `REWARD_DISTRIBUTOR`, `CONTRIBUTOR_DISTRIBUTOR` | | from the deployment | |
| `DEPLOYMENTS_FILE` | | | alternative: path to a deployments JSON instead of the address variables |
| `TREASURY_ADDRESS` | | `TREASURY` | launch policy owners (default `PAYTO_ADDRESS`) |
| `MAX_SUPPLY` | | `2000` | |
| `KEEPER_*` | | see `apps/api/.env.example` | intervals and thresholds (§11) |
| `SWEEP_LISTINGS_URL` | | | JSON feed of Counsel listings for `GET /flywheel/sweep-candidates` |
| `FLYWHEEL_CACHE_SECONDS`, `FLYWHEEL_EVENT_BLOCKS` | | `15`, `50000` | |
| `ORCHESTRATOR_RUNTIME` | | `anthropic-api` | `claude` / `codex` / `anthropic-api` |
| `ANTHROPIC_API_KEY` | 🔒 | | Managing Partner planning |
| `ANTHROPIC_MODEL` | | `claude-sonnet-5-5` | |
| `PREMIUM_MODELS` | | unset (Opus 5.5 / Fable 5.1 / GPT-6 Astra / GPT-6 class at high effort) | regex override |
| `REQUIRE_REGISTRATION` | | `true` | seats must be ERC-8004 agents |
| `HEARTBEAT_MS`, `LEASE_SCALE`, `SCHEDULE_MIN_INTERVAL_SECONDS` | | | tuning |
| `SKILLS_DIR` | | `/app/skills` (image default) | |
| `REWARD_GENESIS` | | `2026-10-05T00:00:00Z` | weekly Counsel epochs |
| `REWARD_EPOCH_COMD_POOL`, `REWARD_EPOCH_ETH_POOL` | | unset | optional per-epoch caps |
| `ADMIN_TOKEN` | 🔒 | random 32+ bytes | bearer for `POST /launches/:id/assurances`, `POST /admin/settle` |
| `SANDBOX_NET` | | `env` (image default) | Railway does not allow user namespaces |
| `FORGE_BIN`, `SOLC_BIN`, `LAUNCH_SOLC` | | set by the image | |
| `SERVICES_MODE` | | unset | `mock` forces mock Clerk/Registrar (never in production) |
| `GIT_COMMIT` | | from `RAILWAY_GIT_COMMIT_SHA` | shown in `/health` |
| `ALLOW_EPHEMERAL_STORAGE` | | unset | `1` silences the no-volume warning (CI only) |

### web (all build-time: change → redeploy)

| Variable | Production value | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.comd.fun` | image default; required unless mock |
| `NEXT_PUBLIC_SITE_URL` | `https://comd.fun` | canonical URLs, Open Graph |
| `NEXT_PUBLIC_MOCK` | `0` | `1` = fixture data, no network (CI, previews) |
| `NEXT_PUBLIC_CHAIN_ID` | `4663` (testnet `46630`) | |
| `NEXT_PUBLIC_RPC_URL` | public RPC | a browser-safe RPC (it is public) |
| `NEXT_PUBLIC_EXPLORER_URL` | `https://robinhoodchain.blockscout.com` | |
| `NEXT_PUBLIC_WC_PROJECT_ID` | | WalletConnect / Reown project id (public) |
| `NEXT_PUBLIC_SITES_DOMAIN` | `sites.comd.fun` | |
| `NEXT_PUBLIC_CONTACT_EMAIL` | `team@comd.fun` | footer |
| `NEXT_PUBLIC_X_URL` | `https://x.com/comdfun` | X profile (image default); the link is hidden when empty |
| `NEXT_PUBLIC_ALLOWLIST_URL`, `NEXT_PUBLIC_MARKETPLACE_URL` | | optional (allowlist proofs; Counsel marketplace link) |
| `NEXT_PUBLIC_COUNSEL_NFT`, `NEXT_PUBLIC_COMD_TOKEN`, `NEXT_PUBLIC_COMD_ROUTER`, `NEXT_PUBLIC_COMD_TAX_HOOK`, `NEXT_PUBLIC_FLYWHEEL`, `NEXT_PUBLIC_BUY_WALL`, `NEXT_PUBLIC_STAKED_COMD`, `NEXT_PUBLIC_REWARD_DRIPPER`, `NEXT_PUBLIC_BOND`, `NEXT_PUBLIC_PERMIT2`, `NEXT_PUBLIC_INCORPORATIONS`, `NEXT_PUBLIC_INCORPORATIONS_FROM_BLOCK`, `NEXT_PUBLIC_IDENTITY_REGISTRY`, `NEXT_PUBLIC_REVENUE_ROUTER`, `NEXT_PUBLIC_REWARD_DISTRIBUTOR`, `NEXT_PUBLIC_CONTRIBUTOR_DISTRIBUTOR` | from `deployment-env.mjs` | optional overrides; otherwise `@company/abi` `addresses[chainId]` (committed after deploy) |

Nothing on the web service is secret: every `NEXT_PUBLIC_*` value ships to browsers.

### GitHub Actions secrets

| Secret | Used by |
|---|---|
| `WORKER_RELEASE_TOKEN` | `release-worker.yml` (publishing to `comd-fun/worker` from this repo) |
| `DEPLOYER_PRIVATE_KEY`, `POL_PRIVATE_KEY`, `RPC_URL_MAINNET`, `RPC_URL_TESTNET` | `deploy-contracts.yml` (plus the role-address variables, §3) |

## 6. Domains and email

On each service: *Settings → Networking → Custom domain*. Railway shows the DNS records to create.

| Domain | Service | Record |
|---|---|---|
| `comd.fun` (and `www.comd.fun` if wanted) | `web` | ALIAS / flattened CNAME at the apex (or the A record Railway lists) → the target Railway shows |
| `api.comd.fun` | `api` | CNAME → target |
| `*.sites.comd.fun` | `api` | wildcard CNAME → target, **plus** the `_acme-challenge.sites.comd.fun` CNAME Railway lists (wildcard certificates use DNS validation) |

Set `SITES_DOMAIN=sites.comd.fun` (api) and `NEXT_PUBLIC_SITES_DOMAIN=sites.comd.fun` (web). The api routes requests
by `Host`: `<label>.sites.comd.fun` is served from storage (`sites/<label>/current.json` → files), everything else
is the API. If the DNS host proxies traffic (Cloudflare orange cloud), use DNS-only for the wildcard and `api`
records (WebSockets on `/agent` and certificate issuance are simplest without a second proxy).

**Email (`team@comd.fun`).** Create the mailbox (or a forward) with any mail provider, then add the records it
gives you on `comd.fun`: `MX` records, an SPF `TXT` (`v=spf1 include:<provider> -all`), the provider's DKIM
record(s), and a DMARC `TXT` on `_dmarc.comd.fun` (start with `v=DMARC1; p=quarantine; rua=mailto:team@comd.fun`).
These do not conflict with the Railway records above. The address is published as `CONTACT_EMAIL` /
`NEXT_PUBLIC_CONTACT_EMAIL` and in the worker release notes.

## 7. Open the market: seed 100% of COMD

The official COMD/ETH pool (`ComdTaxHook`: ETH/COMD, LP fee 0, tick spacing 200, 5% ETH tax) is opened once by
the POL wallet with `contracts/script/SeedPool.s.sol`: `approve`, then `ComdTaxHook.initializeAndSeed`, which
**initializes the pool and deposits the whole supply in the same transaction** (no window to trade before the
liquidity exists). The position is single-sided COMD from the minimum usable tick up to the opening price and is
locked forever.

```bash
cd contracts
export RPC_URL=https://rpc.mainnet.chain.robinhood.com      # testnet: https://rpc.testnet.chain.robinhood.com
export POL_PRIVATE_KEY=0x…                                   # the POL wallet
export HOOK=$(node -p "require('./deployments/4663.json').comdTaxHook")
export INITIAL_MARKET_CAP_WEI=10000000000000000000            # ETH value of all 1B COMD at the opening price (default 10 ETH)
# SEED_COMD defaults to the POL wallet's whole balance (= 100% of supply); leave it unset
forge script script/SeedPool.s.sol:SeedPool --rpc-url $RPC_URL --broadcast
```

The script prints the opening tick, the position liquidity and the COMD left in the POL wallet (rounding dust
only). Check: `cast call $HOOK "positionLiquidity()(uint128)"` is non-zero and a small test buy through
`ComdRouter.swapExactETHForComd` (or the site's Swap page) pays 5% to the Flywheel
(`cast call <flywheel> "totalTaxIn()(uint256)"`).

The inventory cap starts at the seeded amount and decays by at most 100,000 COMD/day, so trims (85% burn / 6% Bond
/ 4.5% sCOMD stakers / 4.5% Counsel seats) and the buy wall only start working once sells bring inventory back
above a cap that has decayed. That is by design (proportional to IMD's POOL4); nothing needs to be done.

### Bond

`Bond` starts **disabled** with `priceEth = BOND_PRICE_WEI` (wei per 1 COMD; default 1e10, the opening price of a
10 ETH market cap). It only sells what trims sent it (6%). When you want it open: check `reserve()` and the market
price, `setPrice(<wei per COMD>)` if needed, then `setEnabled(true)` from `ADMIN`. ETH proceeds go straight to
`treasury()`. The owner can set any non-zero price (review L-05): keep `ADMIN` behind a multisig.

## 8. Counsel mint (free)

`CounselNFT` ("Company.md Counsel", `COUNSEL`) defaults: phase **0 (closed)**, price **0 ETH** (free mint),
`maxPerWallet` 2, 2,000 seats. All setters are `onlyOwner` = `ADMIN` (on mainnet: Safe transactions).

```bash
C=$(node -p "require('./contracts/deployments/4663.json').counselNFT")
cast call $C "price()(uint256)" --rpc-url $RPC_URL                    # 0 → free mint (gas only)
cast send $C "setMaxPerWallet(uint256)" 2 --private-key $ADMIN_KEY --rpc-url $RPC_URL
# optional team/partner seats first
cast send $C "reserveMint(address,uint256)" 0xRecipient 10 --private-key $ADMIN_KEY --rpc-url $RPC_URL
# phase 1: allowlist (Merkle root over addresses; serve proofs at NEXT_PUBLIC_ALLOWLIST_URL)
cast send $C "setAllowlistRoot(bytes32)" 0x<root> --private-key $ADMIN_KEY --rpc-url $RPC_URL
cast send $C "setPhase(uint8)" 1 --private-key $ADMIN_KEY --rpc-url $RPC_URL
# phase 2: public
cast send $C "setPhase(uint8)" 2 --private-key $ADMIN_KEY --rpc-url $RPC_URL
# close again
cast send $C "setPhase(uint8)" 0 --private-key $ADMIN_KEY --rpc-url $RPC_URL
```

Freeze metadata only when final: `setBaseURI(...)` then `freezeMetadata()`. `COUNSEL_BASE_URI` at deploy points
`tokenURI` at the api (`https://api.comd.fun/agents/by-token/<id>.json`).

## 9. Mainnet checklist (4663)

Only after an outside audit. Same flow as §2–§8 with these additions:

1. **External address checklist** (`npm run contracts:verify-mainnet` = `scripts/check-mainnet-addresses.sh`):
   - [ ] `eth_chainId` of `RPC_URL` is `0x1237` (4663)
   - [ ] Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`: code, `DOMAIN_SEPARATOR()` answers
   - [ ] Uniswap v4 PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951`: code, `extsload` answers; verified source on Blockscout is Uniswap's
   - [ ] `SEAPORT` (if used for floor sweeps): the marketplace's verified Seaport deployment
   - [ ] `ADMIN` is a multisig (+ timelock); `POL`, `SETTLER`, `KEEPER`, `REGISTRAR` are separate wallets
2. `npm run contracts:deploy:mainnet` — refuses unless the checklist passes, `ADMIN` ≠ deployer and every role
   wallet is set explicitly; asks you to type `deploy mainnet` (or `CONFIRM_MAINNET=yes`).
3. Post-deploy: `ADMIN` accepts ownership of `ComdTaxHook` and `Flywheel`; hook address `& 0x3fff == 0x18CC`,
   `LaunchGuardHook & 0x3fff == 0x2000`; verify sources on Blockscout (solc 0.8.26, optimizer 200, cancun,
   `bytecode_hash = none`; ERC-8004 implementations via-IR).
4. Choose `INITIAL_MARKET_CAP_WEI` and seed (§7). This is irreversible.
5. Railway: `CHAIN_ID=4663`, `RPC_URL`, `LAUNCH_CHAINS=4663`, the mainnet addresses, `PAYMENTS_MODE` unset (real
   settlement), funded `SETTLER` and `KEEPER`. Web: `NEXT_PUBLIC_CHAIN_ID=4663` + addresses, redeploy. Keep the
   testnet rehearsal in a separate Railway environment with its own Postgres and volume.

## 10. Releasing the worker CLI

Seats install `comd` from GitHub Releases only (never npm). Asset names are fixed by `apps/worker/src/updater.ts`
and `apps/worker/package.json` → `comdWorker`: **`comd-worker.tgz`** + **`SHA256SUMS`**, in the releases repo
**`comd-fun/worker`**, tagged `v<version>`; the updater reads `releases/latest` (pre-releases are ignored).

```bash
# 1. bump apps/worker/package.json "version" (e.g. 0.2.0), commit
# 2. tag and push
git tag worker-v0.2.0 && git push origin worker-v0.2.0
```

`.github/workflows/release-worker.yml` then: checks tag == package version, runs the worker tests,
`scripts/pack-worker.sh` (esbuild bundle → self-contained tarball with `viem` + `ws` bundled, so the updater's
`npm install --offline` probe works with an empty cache), verifies the checksum and an offline install +
`comd help`, and publishes release `v0.2.0` with both assets to `comd-fun/worker` (secret `WORKER_RELEASE_TOKEN`).
`-rc` style versions are published as pre-releases, which auto-update ignores. Locally: `npm run worker:pack` →
`dist/worker-release/`. Seats then run:

```sh
d="$(mktemp -d)"; (cd "$d" \
  && curl -fsSLO https://github.com/comd-fun/worker/releases/latest/download/comd-worker.tgz \
          -O https://github.com/comd-fun/worker/releases/latest/download/SHA256SUMS \
  && sha256sum -c SHA256SUMS)
npm install --global "$d/comd-worker.tgz"
comd start            # pairs the machine with a Counsel seat (config in ~/.comd/)
```

## 11. Operations: keeper, flywheel, backups

- **Logs / health:** Railway logs per service; `GET /health` lists degraded subsystems, the gas wallet balances and
  the commit; `GET /services` shows per-subsystem state.
- **Keeper:** runs inside the api when `KEEPER_PRIVATE_KEY` is set (the `KEEPER` wallet; it must be
  `Flywheel.keeper()` for buybacks — the owner changes it with `Flywheel.setKeeper(address)`). Every
  `KEEPER_INTERVAL_SECONDS` (60) it simulates each task, then sends only what is needed, in this order:
  - `ComdTaxHook.flush()` when tax or trim proceeds are held as PoolManager claims (every
    `KEEPER_FLUSH_EVERY_SECONDS`, 600);
  - `BuyWall.rebalance()` when `canRebalance()` (every `KEEPER_REBALANCE_EVERY_SECONDS`, 300;
    `KEEPER_REQUIRE_PROFIT=true` skips it while the simulated tip is below the gas cost);
  - `RewardDripper.drip()` when `pending() > 0`, at least hourly (`KEEPER_DRIP_EVERY_SECONDS`, capped at 3600);
  - `Flywheel.buyback(minOut)` when the buyback bucket ≥ `KEEPER_BUYBACK_MIN_WEI` (0.05 ETH), at most every
    `KEEPER_BUYBACK_EVERY_SECONDS` (900); `minOut` = simulated output − `KEEPER_BUYBACK_SLIPPAGE_BPS` (3%); burned;
  - `RevenueRouter.distribute()` when it holds ≥ `KEEPER_DISTRIBUTE_MIN_COMD` (1,000 COMD): 80% Counsel rewards /
    20% firm treasury;
  - it stops sending below `KEEPER_MIN_ETH_WEI` (0.001 ETH). Status: `GET /services` (kind `keeper`) and
    `GET /health` (`keeper_off` / `keeper_low_gas`).
  Floor sweeps are a deliberate manual step: review `GET /flywheel/sweep-candidates` (from `SWEEP_LISTINGS_URL`),
  then the keeper or `ADMIN` calls `Flywheel.sweep(adapter, data, tokenId, maxPrice)`; swept Counsel can be
  re-issued with `awardSwept`. Every keeper call is permissionless or owner-callable, so `cast send` is the manual
  fallback.
- **Counsel epochs:** weekly from `REWARD_GENESIS`; the settler posts one COMD root per epoch (80% of job revenue +
  4.5% of trims, split by accepted work). Holders claim on the site.
- **Backups:** enable Railway Postgres backups. The volume holds content-addressed blobs and sites; back it up
  (or use a bucket with versioning).
- **Rollback:** Railway *Deployments → Redeploy* an earlier build. Migrations are forward-only; write additive ones.
- **Key rotation:** attester — publish the new address, then swap `ATTESTER_PRIVATE_KEY`; settler/registrar — grant
  the role to the new wallet from `ADMIN`, swap the key, revoke the old one; keeper — `Flywheel.setKeeper(new)`,
  then swap `KEEPER_PRIVATE_KEY`.
- **Scaling:** keep `api` at one replica. Scale `web` freely.

## 12. Local and CI equivalents

| Here | Command |
|---|---|
| Whole stack locally (anvil 46630 → contracts → seeded pool → api → web) | `npm run local` (`scripts/local-stack.sh`; `--contracts-only`, `--no-web`) |
| Build / test everything | `npm run build`, `npm test`, `npm run contracts:test` |
| The images | `docker build -f infra/docker/api.Dockerfile -t comd-api .` / `docker build -f infra/docker/web.Dockerfile -t comd-web .` |
| CI | `.github/workflows/ci.yml`: workspaces build + tests, web build in mock mode, `forge test` with the pinned libs, both images built and smoke-tested |
