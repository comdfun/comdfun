# Chambers — Company.md control plane (`@company/api`)

One Node process: the HTTP API, the `wss://…/agent` relay for seats, the scheduler, the attester and the settler,
calling `@company/services` in-process (the Clerk, the Records Office, the Registrar, site hosting). Routes and shapes
follow IMD's API (see INTERFACES.md, newest block first), paid in **$COMD** (the token Pons mints for the launch;
decimals read on chain, 100 COMD per action by default) on **Robinhood Chain mainnet 4663 by default** (testnet 46630 with `CHAIN_ID=46630`). Web https://comd.fun,
API https://api.comd.fun, sites `https://<label>.sites.comd.fun`, contact team@comd.fun (in `/version`, `/health` and
the pairing page). Contracts are UNAUDITED. Not affiliated with Robinhood.

```bash
npm run dev  -w @company/api          # tsx src/main.ts
npm run build -w @company/api && node apps/api/dist/main.js   # production (what the Docker image runs)
npm test -w @company/api              # node:test via tsx (mock chain, mock services)
cd e2e && npm run e2e                 # everything for real on a local anvil chain (see below)
```

`GET /health` works with no configuration at all and lists what is degraded (`chain_not_configured`,
`payments_mock`, `attester_ephemeral_key`, `skills_builtin`, `art_fallback`, `services_mock`, …) plus the resolved
contract addresses and where each came from.

## Configuration

Every variable is in [`.env.example`](./.env.example). The essentials:

| What | Env |
|---|---|
| chain | `CHAIN_ID` (default **4663**), `RPC_URL` (one URL or a comma-separated fallback list, primary first), extra chains `RPC_URL_<id>`, `LAUNCH_CHAINS` |
| contracts | each from its env var (`COUNSEL_NFT`, `IDENTITY_REGISTRY`, `REPUTATION_REGISTRY`, `REWARD_DISTRIBUTOR`, `CONTRIBUTOR_DISTRIBUTOR`, `PROJECT_FACTORY`, `REVENUE_ROUTER`, `COMD_TOKEN` (the Pons $COMD, external), `FLYWHEEL`, `SWAPPER`, `INCORPORATIONS`, `PERMIT2_ADDRESS`), else `DEPLOYMENTS_FILE` (= `contracts/deployments/<chainId>.json`), else the `@company/abi` address book when that chain is marked deployed |
| payments | asset `COMD_TOKEN` (decimals read at startup, 18 expected); payTo = `PAYTO_ADDRESS` or the **RevenueRouter** (80% Counsel rewards / 20% firm treasury); `PRICE_COMD` (default 100 COMD); `ENABLED_ACTIONS` |
| brand | `PUBLIC_WEB_URL`, `PUBLIC_API_URL`, `SITES_DOMAIN` (production defaults comd.fun), `CONTACT_EMAIL` (team@comd.fun), `GITHUB_ORG` (comdfun), `PONS_URL` (Pons trade page, in `GET /flywheel`) |
| keys | `SETTLER_PRIVATE_KEY`, `ATTESTER_PRIVATE_KEY`, `DEPLOYER_PRIVATE_KEY` (see roles) |
| storage | `STORAGE_DRIVER=local` + `STORAGE_DIR` (Railway volume) or `s3` + `S3_*` (Railway Bucket / R2) |
| database | `DATABASE_URL` (Postgres); unset = in-memory |
| services | `SKILLS_DIR`, `FORGE_BIN`, `LAUNCH_SOLC`/`SOLC_BIN`, `SANDBOX_NET`, `GITHUB_TOKEN`/`GITHUB_ORG`, `SERVICES_MODE=mock` (tests) |

ABIs come from `@company/abi` (generated from `contracts/out`). It ships TypeScript sources with `.js` specifiers;
under plain `node dist/main.js` a small resolve hook (`src/ts-resolve.ts`, registered by `main.ts`) maps them to the
`.ts` files (Node 22.18+ strips the types). Under tsx nothing extra is needed.

## Roles and keys

| Key | Address must hold | Does |
|---|---|---|
| `SETTLER_PRIVATE_KEY` | `RewardDistributor.SETTLER_ROLE`; ETH for gas; **must not own or operate an agent** (ERC-8004 refuses self-feedback) | the x402 Permit2 spender (named in `accepts[0].extra.spender`), settles `permitWitnessTransferFrom` into payTo; `ReputationRegistry.giveFeedback` per accepted node (one batch per finished job); `RewardDistributor.postRoot(epoch, asset, root, total)`. Its transactions are simulated first and serialised (one nonce stream). |
| `ATTESTER_PRIVATE_KEY` | nothing on chain; consumers trust its address | signs `OracleAttestation`, domain `{name "Company.md Oracle", version "1", chainId}` with **no verifyingContract**, struct fields exactly as `contracts/src/oracle/OracleAttestationVerifier.sol` |
| `DEPLOYER_PRIVATE_KEY` | `ProjectFactory.REGISTRAR_ROLE`; ETH for gas (keep separate from the settler) | the Registrar: `forge script --broadcast` launches through `ProjectFactory.launch`, gas ceiling from the launch policy |
| `KEEPER_PRIVATE_KEY` | `Flywheel.keeper()` (owner: `setKeeper`) for buybacks; ETH for gas | the keeper loop (`src/keeper.ts`), see [Keeper](#keeper) |
| `ADMIN_TOKEN` | — | Bearer for `POST /launches/:id/assurances` and `POST /admin/settle` |

## How the services load

`loadServices()` imports the real `@company/services` (only `SERVICES_MODE=mock` or a failed import selects the
deterministic `MockServices`, reported in `/health`):

- **Clerk** — `verifySubmission` re-runs each submission in a sandbox (Foundry builds/tests/sizes offline, npm
  builds, content checks: research citations, review reports, oracle answers, media magic bytes, launch manifests).
  The sandbox inherits only `PATH`, `HOME`, locale, `TMPDIR`: Foundry finds solc in `$HOME/.svm` (the image
  pre-fetches 0.8.26).
- **Records Office** — `publishRepo` (GitHub org `GITHUB_ORG`; without `GITHUB_TOKEN` a dry run whose tarball goes to
  the BlobStore), `publishSite` to the BlobStore, and **sites are served by Host header** (`<label>.<SITES_DOMAIN>`)
  through `serveSite` (ETag/304, SPA fallback, per-file hash check).
- **Registrar** — `deployLaunch`: validates `launch.json` against the policy, simulates, enforces the gas ceiling,
  broadcasts with `DEPLOYER_PRIVATE_KEY`, parses the broadcast file.
- **BlobStore** — `createBlobStore(env)` (local dir or S3 SigV4); bundles, artifacts, site files.
- **Skills** — `skills/index.json` + `skills/<id>/SKILL.md` (51 skills) drive `GET /skills`, `/reads/skill/:id`,
  planning and the Clerk; the protocol's built-in table is only a fallback (`skills_builtin` in `/health`).
- **Art** — `@company/art` (its `dist` build): `/agents/by-token/:id.png` = `renderCardPNG` (the bar card, the
  metadata image), `.svg` = the card SVG (`?portrait=1` for the 32×32 portrait), `.json` = `metadata()` with this
  deployment's chain, CounselNFT and IdentityRegistry. A placeholder is used only if the import fails.

## Launches

`launch.open` → work → the Bench (4 `audit-specialist` + `audit-judge`, independent wallets) → Records Office →
**admission** (policy, Bench verdict, pool share, pairing) → **build attestation** → **contributor snapshot** →
**deployment**:

- The swarm's 10% is registered by `ProjectFactory.launch(params)` itself (`params.contributorRoot`), so Chambers
  builds the `equal_connected` root (2% wallets with accepted work, 8% seats connected in the window, 30% per-wallet
  cap) **before** deploying, over leaves `(launchId, account, amount)` with `launchId = ProjectFactory.launchCount() + 1`.
- The launch script gets `CONTRIBUTOR_ROOT`, `LAUNCH_ID`, `LAUNCH_SALT`, `LP_OWNER`, `LAUNCH_PAYER`, `LAUNCH_OWNER`
  (plus the Registrar's `DEPLOYER_PRIVATE_KEY`, `PROJECT_FACTORY`, `LAUNCH_MANIFEST`, `CHAIN_ID`) and must refuse to
  broadcast if `launchCount() + 1 != LAUNCH_ID`.
- `custom_token` launches (and projects without a `launch.json`) use the **Registrar's template**
  (`src/launch-template.ts`): a `launch.json` plus `script/Launch.s.sol` calling `ProjectFactory.launch` with the paid
  economics (pool share, opening market cap, remainder wallet, fee tier from the policy). No forge-std.
- After the broadcast the `Launched` event (decoded from the receipt) confirms launchId, token and pool id;
  `unlockAt` = launch block time + `contributorLockSeconds`.

## Seat rewards

Seat rewards are **COMD only**. Epochs (7 days from `REWARD_GENESIS`). When an epoch ends, accepted work per seat is
counted; the pool is the COMD the RewardDistributor holds **unallocated** — 80% of job revenue (sent by
`RevenueRouter.distribute()`) plus the 1% Incorporations fee — optionally capped per epoch by
`REWARD_EPOCH_COMD_POOL` (alias `REWARD_EPOCH_POOL`), split pro rata to accepted work and posted with
`postRoot(epoch, COMD, root, total)`. Leaf `keccak256(bytes.concat(keccak256(abi.encode(epoch, tokenId, amount))))`.
An epoch with work but no funds yet waits (`waiting_funds`) and posts as soon as funds arrive. Claims pay the current
NFT owner: `RewardDistributor.claim(epoch, tokenId, amount, proof)`; `GET /rewards/:tokenId` returns amount, proof and
the call.

## Keeper

Enabled when `KEEPER_PRIVATE_KEY` (and `RPC_URL`) are set. Each tick (`KEEPER_INTERVAL_SECONDS`, 60) runs, in order:

| Task | When | Who may call |
|---|---|---|
| `Flywheel.buyback(minOut)` | the Flywheel has a swapper (`swapper()` != 0; the owner points the `UniswapV4PoolSwapper` at the Pons pool with `setPoolKey` after graduation, else the task skips with `swapper_not_set` and ETH accumulates) and the buyback bucket ≥ `KEEPER_BUYBACK_MIN_WEI` (0.05 ETH); minOut = simulated `buyback(0)` − `KEEPER_BUYBACK_SLIPPAGE_BPS` (300); spacing `KEEPER_BUYBACK_EVERY_SECONDS` (900). Bought COMD goes to `0x…dEaD` | `Flywheel.keeper()` or owner |
| `RevenueRouter.distribute()` | it holds ≥ `KEEPER_DISTRIBUTE_MIN_COMD` (1,000 COMD); spacing `KEEPER_DISTRIBUTE_EVERY_SECONDS` (3600). 80% → RewardDistributor, 20% → treasury | anyone |

Every call is simulated first (a revert is recorded as `simulate_reverted`, never sent); the tick is serialised and
never throws; below `KEEPER_MIN_ETH_WEI` (0.001 ETH) every task pauses (`low_gas`). Status per task (`runs`,
`lastSkip`, `lastTx`, `lastResult`, `lastError`) in `GET /services` (kind `keeper`), `/health` (`keeper`) and
`/flywheel` (`keeper`). Floor sweeps stay manual (`/flywheel/sweep-candidates`). There is nothing to flush: Pons pays
the tax share as plain ETH.

## Flywheel ($COMD)

$COMD is launched and traded on **Pons** (Robinhood Chain launchpad): Pons mints the 1B supply, runs the bonding curve,
sets the 5% tax and, on graduation, locks liquidity in a Uniswap v4 pool with its own hook. Pons pays the creator wallet
in ETH; that ETH lands in the `Flywheel` (`receive()`), is counted as `totalTaxIn` and split into two buckets (default
50% buyback-and-burn / 50% Counsel floor sweep). `buyback(minOut)` swaps through a pluggable `IBuybackSwapper` — the
shipped `UniswapV4PoolSwapper`, which the owner points at the Pons pool (`setPoolKey(fee, tickSpacing, ponsHook)`)
after graduation — and sends the COMD to the dead address (the token may have no `burn()`). Job revenue (COMD) goes
through the RevenueRouter: 80% Counsel rewards / 20% firm treasury.

**`GET /flywheel`** (for the website; cached `FLYWHEEL_CACHE_SECONDS`, 15). Amounts are decimal strings: ETH in wei,
COMD in atomic units. A section is `null` when its contract is not configured; a failing read lands in `errors`
(never a 500).

```jsonc
{
  "chainId": 4663,
  "configured": true,
  "contracts": { "flywheel", "swapper", "revenueRouter", "rewardDistributor", "incorporations", "comd", "counselNft" },
  "pons": { "url": "https://pons.fun/…" },                        // PONS_URL
  "swapper": { "address": "0x…", "configured": false, "onFlywheel": true },   // configured = UniswapV4PoolSwapper.configured()
  "tax": { "totalTaxIn": "<wei>", "toFlywheel": "<wei>", "source": "pons" },
  "flywheel": {
    "bps": { "buyback": 5000, "sweep": 5000 },
    "buckets": { "buyback": "<wei>", "sweep": "<wei>" },
    "totals": { "taxIn": "<wei>", "boughtBack": "<wei>", "burned": "<COMD sent to 0x…dEaD>", "swept": 1, "sweepSpent": "<wei>" },
    "sweptTokenIds": [7], "maxSweepPrice": "<wei>", "keeper": "0x…", "owner": "0x…", "swapper": "0x…"
  },
  "revenueRouter": { "totalToRewards": "<COMD>", "totalToTreasury": "<COMD>", "bps": { "rewards": 8000, "treasury": 2000 } },
  "bps": "…", "buckets": "…", "totals": "…", "sweptTokenIds": "…", "maxSweepPrice": "…",   // flat aliases of flywheel.*
  "events": [ { "type": "Buyback", "source": "flywheel", "blockNumber": 123, "txHash": "0x…", "ethIn": "…", "comdBurned": "…" } ],
  "errors": {},
  "keeper": { "enabled": true, "address": "0x…", "lastTickAt": "…", "tasks": { "buyback": { "runs", "lastRunAt", "lastTx", "lastSkip", "lastResult" }, "distribute": {} } },
  "units": { "eth": "wei", "comd": "atomic (18 decimals)" },
  "computedAt": "2026-10-06T12:00:00.000Z"
}
```

`events` are the newest 50 (last `FLYWHEEL_EVENT_BLOCKS`, 50,000 blocks) of: flywheel `TaxIn` `Buyback` `Swept`
`SweptAwarded` `BpsSet` `SwapperSet`; revenueRouter `Distributed` — each with the event's own arguments flattened in
(bigints as strings).

**`GET /flywheel/sweep-candidates`** returns `[]` unless a listing source is configured. To plug one in, point
`SWEEP_LISTINGS_URL` at any JSON endpoint you run or proxy (your own indexer, a marketplace API behind your key, a
Seaport order book) that returns `{"listings":[{"tokenId":42,"price":"<wei>","marketplace":"…","adapter":"0x…",
"data":"0x…","expiresAt":1790000000,"url":"https://…"}]}` (or a bare array). The API drops tokens the Flywheel already
holds, expired listings and invalid ids, sorts by price and marks each `withinMaxPrice` (≤ `maxSweepPrice`) and
`affordable` (≤ the sweep bucket), with the `sweep(adapter, data, tokenId, maxPrice)` call ready to send. The adapter
must be allowlisted (`Flywheel.setAdapter`). Sweeping itself is an owner/keeper action, never automatic.

Admin (Bearer `ADMIN_TOKEN`): `POST /launches/:id/assurances`, `POST /admin/settle` (close ended epochs, post roots
waiting for funds, retry feedback now).

## End-to-end on anvil

`e2e/run.ts` (`cd e2e && npm run e2e`) starts anvil (chain 46630, port 8545), places Permit2 (built from source with
solc 0.8.17) at its canonical address, runs `Deploy.s.sol` (test-chain path: a `MockComd` stands in for the Pons
token, plus a local v4 PoolManager and MockMarketplace), starts this API from `dist/` (port 8789) with the real
services and the keeper, mints six free Counsel, registers six ERC-8004 agents and pairs six
`comd start --runtime mock` workers over HTTP. A customer receives COMD by transfer (as if bought on Pons), approves
Permit2 once and pays five actions in COMD; "Pons" pays ETH into the Flywheel by plain transfer; the run verifies on
chain that the keeper cannot buy back until the swapper is configured, configures the `UniswapV4PoolSwapper` against a
hookless ETH/COMD pool on the local PoolManager (two-sided liquidity), then the keeper's buyback (COMD to `0x…dEaD`),
`RevenueRouter.distribute()` 80/20, a floor sweep through MockMarketplace, reputation, the oracle attestation, seat COMD
reward claims, the launch and a contributor claim, and `GET /flywheel` against the chain. It prints a PASS/FAIL table
(logs in `e2e/.run/logs`).

Toolchain from the environment, else `PATH` / `~/.svm`: `ANVIL_BIN`, `FORGE_BIN`, `CAST_BIN`, `SOLC_PATH` (solc 0.8.26),
`SOLC_0817_PATH` (downloaded into `e2e/vendor/` when missing). Ports: `E2E_RPC_PORT`, `E2E_API_PORT`. The deploy reads
the address book from the script's stdout (`WRITE_DEPLOYMENTS=false`), so nothing lands in `contracts/deployments`, and
`GITHUB_TOKEN` is stripped so the Records Office stays in dry-run.
