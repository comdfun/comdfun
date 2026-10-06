# Deploying Company.md (Pons mode)

Launch order, in one page. Details of each contract: `contracts/README.md`. API env: `apps/api/.env.example`.
Web env: `apps/web/.env.example`.

$COMD is launched on **Pons** (Robinhood Chain launchpad). Pons mints the token, runs the bonding curve, locks the
liquidity at graduation and pays the Creator wallet in ETH (the 5% tax plus 70% of its 1% fee). Our contracts never
own a pool. Everything below assumes Robinhood Chain mainnet (chain id 4663); the testnet (46630) works the same with
`network: testnet` and no `comd_token` (a MockComd stand-in is deployed).

## 0. Accounts and keys

| Role | Where the key lives | Needs ETH |
|---|---|---|
| Creator | your wallet; launches $COMD on Pons, receives Pons payouts, forwards them to the Flywheel | Pons launch fee + any dev buy |
| Deployer | GitHub secret `DEPLOYER_PRIVATE_KEY` | ~0.02 |
| Admin | hardware wallet / multisig; owns every contract (`ADMIN` variable, must differ from the deployer) | ~0.01 |
| Treasury | receives 20% of job revenue in COMD (`TREASURY`; can be the Admin) | 0 |
| Settler | api `SETTLER_PRIVATE_KEY`; work records, reward roots | ~0.05, top up |
| Registrar | api `DEPLOYER_PRIVATE_KEY`; deploys the swarm's launches | ~0.05, top up |
| Keeper | api `KEEPER_PRIVATE_KEY`; buybacks and the revenue split (`KEEPER` variable) | ~0.02 |
| Attester | api `ATTESTER_PRIVATE_KEY`; signs oracle rulings off-chain | 0 |

Other credentials: `ANTHROPIC_API_KEY` (Managing Partner planning), a GitHub fine-grained token with Contents
read/write on `comdfun/worker` and repo creation in the `comdfun` org (api `GITHUB_TOKEN`, repo secret
`WORKER_RELEASE_TOKEN`), optionally a WalletConnect project id (`NEXT_PUBLIC_WC_PROJECT_ID`).

## 1. GitHub

1. Push this repository to `comdfun/comdfun`; create the empty public repo `comdfun/worker` for CLI releases.
2. Settings → Secrets and variables → Actions:
   - Secrets: `DEPLOYER_PRIVATE_KEY`, `RPC_URL_MAINNET` (`https://rpc.mainnet.chain.robinhood.com`),
     `RPC_URL_TESTNET` (`https://rpc.testnet.chain.robinhood.com`), `WORKER_RELEASE_TOKEN`.
   - Variables: `ADMIN`, `TREASURY`, `KEEPER`, `SETTLER`, `REGISTRAR`, `ATTESTER` (addresses). Optional:
     `MAX_SWEEP_PRICE` (wei), `SEAPORT`, `COUNSEL_BASE_URI`.
3. Settings → Environments → `mainnet` with yourself as required reviewer: a mainnet deploy then waits for your click.

## 2. Railway

1. New project → Deploy from GitHub repo `comdfun/comdfun`. Add two services from it. Railway's "Config as Code"
   is deprecated (new services cannot opt in), so set the builder with a variable and the rest in Settings:
   - `api`: Variables → `RAILWAY_DOCKERFILE_PATH=infra/docker/api.Dockerfile`; Settings → Deploy → Healthcheck Path
     `/health`, Healthcheck Timeout 300, Restart Policy On Failure (10), 1 replica; Volume mounted at `/data`;
     custom domains `api.comd.fun` and `*.sites.comd.fun`.
   - `web`: Variables → `RAILWAY_DOCKERFILE_PATH=infra/docker/web.Dockerfile`; Healthcheck Path `/`; custom
     domains `comd.fun` and `www.comd.fun`.
   - Root Directory stays empty on both. `infra/railway/*.json` document the same settings (watch patterns included)
     for accounts that still have Config as Code.
2. Add a PostgreSQL database; on `api` set `DATABASE_URL = ${{Postgres.DATABASE_URL}}`.
3. DNS: add the CNAME records Railway shows for each domain (the wildcard also needs its `_acme-challenge` record).
   Add your mail provider's MX records for `team@comd.fun`.
4. Variables: paste the block printed by the deploy workflow (§4) into each service, then add the secrets from §0.
   `NEXT_PUBLIC_*` values are baked into the web build; redeploy `web` after changing any of them.
5. The api runs the control plane, scheduler, attester, settler and keeper in one process: keep it at 1 replica.

## 3. Launch $COMD on Pons

Form values: name `Company.md`, symbol `COMD`, supply 1,000,000,000, pair ETH, tax 5%, logo
`packages/art/out/brand/logo-mark-padded-black-1000.png`, description "A swarm of NFT-identified agents that work
together to perform AI tasks on chain.", links `https://comd.fun`, `https://x.com/comdfun`.

Note the token address: it is the `comd_token` input in §4. If Pons lets you set the fee/tax recipient to any
address, set it to the Flywheel address after §4; otherwise the Creator wallet forwards ETH to the Flywheel (a plain
transfer to the contract; every wei counts as tax income and is split 50/50 between buyback-and-burn and floor sweeps).

## 4. Deploy the contracts (GitHub Actions)

Actions → **deploy-contracts** → Run workflow: `network` mainnet, `comd_token` = the Pons token address,
`confirm` = `deploy mainnet`. (Run it once on testnet first with `comd_token` empty.)

The job checks the RPC chain id, the role addresses, that the token has code and 18 decimals, runs
`scripts/check-mainnet-addresses.sh`, deploys with `Deploy.s.sol`, verifies `Flywheel.comd()` and the
LaunchGuardHook address flags, uploads `deployments/4663.json` as an artifact and prints the Railway env block in the
job summary. From a laptop instead: `scripts/deploy-contracts.sh mainnet` with the same env.

After the run:
1. Commit `contracts/deployments/4663.json` and run `npm run contracts:abi` (the address book the apps read).
2. Admin calls `acceptOwnership()` on the Flywheel (Ownable2Step). The other contracts are owned by Admin directly.
3. Paste the env block into Railway (§2.4). Real payments settle on-chain as soon as `SETTLER_PRIVATE_KEY` and `RPC_URL` are set (leave `PAYMENTS_MODE=off`; `mock` is for local demos only).

## 5. Open for business

1. Admin: `CounselNFT.setPhase(2)` (public, free mint; `setPhase(1)` + `setAllowlistRoot` for an allowlist first).
2. Release the agent software: tag `worker-v0.1.0` and push; `release-worker.yml` publishes `comd-worker.tgz` and
   `SHA256SUMS` to `comdfun/worker` under tag `v0.1.0`. Holders install with the commands in `apps/worker/README.md`.
3. Watch `https://api.comd.fun/health` (degraded flags), `/services` (keeper), `/flywheel`.

## 6. After the Pons graduation

Pons moves liquidity into a Uniswap v4 pool with its own hook. Read the pool's `fee`, `tickSpacing` and `hooks`
address from the graduation transaction (or Pons's UI) and, as Admin, call `setPoolKey(fee, tickSpacing, hooks)` on
the swapper (`UniswapV4PoolSwapper`, deployments key `swapper`). From then on the keeper runs `Flywheel.buyback`
whenever the buyback bucket holds ≥ `KEEPER_BUYBACK_MIN_WEI`; bought COMD goes to `0x…dEaD`. If Pons's hook rejects
swaps from our swapper, deploy another `IBuybackSwapper` (for example one routing through Uniswap's UniversalRouter)
and `Flywheel.setSwapper(...)`; ETH keeps accumulating safely meanwhile. Set `NEXT_PUBLIC_UNISWAP_URL` on `web`.

Floor sweeps: allowlist a marketplace adapter (`Flywheel.setAdapter`), set `MAX_SWEEP_PRICE`, and sweep with
`Flywheel.sweep(adapter, data, tokenId, maxPrice)` (keeper or Admin). `GET /flywheel/sweep-candidates` lists
candidates once `SWEEP_LISTINGS_URL` points at a listing feed.

## 7. Keeper tasks (api, `KEEPER_PRIVATE_KEY`)

| Task | When |
|---|---|
| `Flywheel.buyback(minOut)` | swapper configured and buyback bucket ≥ `KEEPER_BUYBACK_MIN_WEI`; simulated first, `KEEPER_BUYBACK_SLIPPAGE_BPS` |
| `RevenueRouter.distribute()` | undistributed job revenue ≥ `KEEPER_DISTRIBUTE_MIN_COMD` (80% Counsel rewards / 20% treasury) |

Status: `GET /services` (Keeper row) and `GET /health` (`keeper_off`, `keeper_low_gas`).

## 8. Checklist before mainnet

- [ ] External audit, or at least a second review of `contracts/SECURITY_REVIEW.md`
- [ ] `ADMIN` is a hardware wallet or multisig and differs from the deployer
- [ ] `scripts/check-mainnet-addresses.sh` passes with `COMD_TOKEN` set
- [ ] Testnet run completed end to end (deploy, mint, pair a worker, pay a job)
- [ ] Railway domains resolve with TLS; `/health` is green and shows payments live
