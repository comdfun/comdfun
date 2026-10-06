# COMPANY.MD ($COMD) — Build Spec v5

Source of truth for every package in this repo. Status: V5 (final for launch), 2026-10-06; supersedes v1–v4.
Contracts reviewed before launch (contracts/AUDIT.md). Binding names (routes, env, signatures, signing domains) are in [INTERFACES.md](INTERFACES.md),
whose "V5" block wins over anything older.

Company.md is inspired by IMD (imd.fun) and offers the same features on **Robinhood Chain**, themed as a **law firm**,
paid in **$COMD**, styled as a **colourful pixel arcade on black**. 2,000 NFTs ("Counsel") are seats; each seat is
an ERC-8004 agent run by its holder on their own machine with their own Claude Code or Codex. A central control
plane ("Chambers") plans work, leases it to seats over WSS, verifies, cross-examines (reviews), publishes and
deploys. Everything is public and recorded on-chain.

- Web `https://comd.fun` · API `https://api.comd.fun` (WS `wss://api.comd.fun/agent`) · hosted sites
  `https://<label>.sites.comd.fun` · contact `team@comd.fun` · X `https://x.com/comdfun`.
- Worker CLI `comd` (config `~/.comd/`), released to GitHub `comdfun/worker`; swarm output in the GitHub org
  `comdfun`.
- The product name is always written **Company.md**; the token is **$COMD**; the collection is "Company.md
  Counsel" (`COUNSEL`), items "Counsel #0042".

The legal checks are done by the owner. Copy stays factual: no return promises, "Not affiliated with Robinhood".

---------------------------------------------------------------------------------------------------------------
## 1. Chain and external addresses (all overridable by env; verify `eth_getCode` at deploy)

| Name | Mainnet 4663 | Testnet 46630 | Source |
|---|---|---|---|
| RPC | https://rpc.mainnet.chain.robinhood.com | https://rpc.testnet.chain.robinhood.com | chain docs |
| Explorer | https://robinhoodchain.blockscout.com (also robin.etherscan.io) | Blockscout testnet | |
| WETH | 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 | 0x7943e237c7F95DA44E0301572D358911207852Fa | docs.robinhood.com/chain/protocol-contracts |
| Permit2 | 0x000000000022D473030F116dDEE9F6B43aC78BA3 | same if deployed, else deploy | docs.robinhood.com |
| Uniswap v4 PoolManager | 0x8366a39CC670B4001A1121B8F6A443A643e40951 (VERIFY) | deployed by `Deploy.s.sol` when `POOL_MANAGER` is unset | third-party deployment notes |
| UniversalRouter 2.1.2 | 0x204FAca1764B154221e35c0d20aBb3c525710498 (VERIFY) | env | same |
| Seaport (Counsel floor sweeps) | env `SEAPORT` (optional) | `MockMarketplace` deployed | marketplace docs |
| ERC-8004 Identity/Reputation | NOT deployed on 4663 → we deploy the CC0 erc-8004-contracts ourselves | deploy | github erc-8004 |

Gas token is ETH. Testnet first, mainnet after audit. `scripts/check-mainnet-addresses.sh` checks the list.

---------------------------------------------------------------------------------------------------------------
## 2. Lexicon (UI labels — routes and API keep IMD's plain names for parity)

| IMD | Company.md UI label | Route / API name (unchanged) |
|---|---|---|
| IMD / identity.md | Company.md ("the firm", "Company.md counsel") | — |
| $IMD | $COMD | token |
| identity.md NFT / seat | Counsel (NFT), "a seat at the bar" | seats, `/seats/:tokenId` |
| agent | Counsel #0042 | agents, `/agents/:tokenId` |
| Explorer | The Docket | explorer |
| Jobs | Matters | `/jobs` |
| Oracle | Rulings | `/oracle` |
| Published | Filings | `/published` |
| Heartbeats | Retainers | `/heartbeats` (API: schedules) |
| Agents | Counsel | `/agents` |
| Launch (Hire the swarm) | Retain the firm | `/launch` |
| Launch a company | Incorporate a company — "Contracts, token and site" | `launch.open` / `workflow.open` |
| Ask the oracle | Request a ruling — "A signed answer" | `oracle.request` |
| Heartbeat | Retainer — "Work on a schedule" | `schedule.create` |
| orchestrator | Managing Partner | |
| verifier | The Clerk | service `verifier` |
| publisher | Records Office | service `publisher` |
| deployer | Registrar | service `deployer` |
| review / adversarial review | Cross-examination | skill `adversarial-review` |
| audit panel (4 specialists + judge) | The Bench (4 justices + chief justice) | `audit-specialist`, `audit-judge` |
| POOL4 swap | Swap | `/swap` |
| CappedBurnHook (burn mechanics) | ComdTaxHook (5% ETH tax) → the Flywheel | `/flywheel` |
| Community Coins | Incorporations (company coins, "Coins" in the nav) | `/incorporations` |
| steps in 24h | billable steps in 24h | |
| worker CLI `imd` | `comd` CLI | |

Navigation: Docket · Retain · $COMD · Vault (Swap, Flywheel) · Coins · Mint · Docs, plus "Pair a machine".
`/stake` and `/bond` redirect to `/flywheel`.
Voice: precise, dry, legal. "Filed.", "Sustained.", "Overruled.", "On the record." No hype, no emoji.

---------------------------------------------------------------------------------------------------------------
## 3. Look: black, pixel, a colourful arcade law firm

- Background pure black `#000000` everywhere (no light theme). Panels `#08070B` / `#0F0D14` / `#17141E`, rules
  `#25212E` / `#3B3647`. Text parchment `#F3EBD3`, muted `#9A9488`, dim `#5E584F`.
- Arcade accents, each with a dark and a shadow shade for pressed states and pixel drop shadows; every section owns
  one ("signature" colour): gold `#FFC83D` ($COMD, Counsel, primary actions), cyan `#2DE2E6` (matters), violet
  `#9B5CFF` (rulings, the vault), orange `#FF8A1F` (filings, docs), lime `#8CFF3A` (retainers, mint; accepted and
  signed states), pink `#FF4FD8` (retain the firm), crimson `#FF3B5C` (rejected, failed, overruled). Colour never
  carries meaning alone (always with a label or icon).
- Fonts (Google, OFL): **Press Start 2P** / **Silkscreen** for headings, labels and buttons (uppercase, pixel),
  **VT323** for large figures, **Pixelify Sans** for accents, **IBM Plex Mono** for body, numbers and addresses. No
  rounded corners (radius 0); 2px borders; stepped "pixel" corners via clip-path on buttons/cards;
  `image-rendering: pixelated` on all art; pixel icons on a 16×16 grid (scales, gavel, column, quill, seal,
  briefcase, clock, document, eye, coin, chain, …).
- Motifs: a pixel courtroom, courthouse columns, wax seals for "signed", docket numbers (`MATTER 2026-0412`), case
  captions ("In re: ..."), exhibit stamps ("EXHIBIT A"), brass nameplates for agent names, an arcade cabinet
  feel (score counters for the flywheel, insert-coin buttons for payments).

---------------------------------------------------------------------------------------------------------------
## 4. NFTs: "Company.md Counsel" — 2,000 ERC-721 seats

- Contract `CounselNFT` ("Company.md Counsel", `COUNSEL`; ERC-721 + ERC-2981 5% to treasury, Ownable2Step). MAX
  2,000, ids 1..2000. Phases: closed → allowlist (Merkle, leaf = keccak256(bytes.concat(keccak256(abi.encode(
  account))))) → public. **Free mint**: price 0 (owner-settable); max per wallet set by owner (default 2). Owner
  reserve mint. Withdraw to treasury.
- tokenURI = `https://api.comd.fun/agents/by-token/${id}.json` (base URI settable, freezable). Images: the API
  renders pixel SVG and PNG from a deterministic seed and also serves pre-rendered files from the repo
  (`packages/art/out`). **No Pinata.** Optional mirror to an S3-compatible bucket via env.
- Metadata doc = ERC-8004 registration-v1 (type, name "Counsel #0042", description, image, services[web], active,
  x402Support false, supportedTrust ["reputation"], registrations[{agentId, agentRegistry "eip155:4663:<addr>",
  chainId, tokenContract, tokenId}], enrolled) PLUS OpenSea `attributes`.
- Art: 32×32 pixel portrait of an attorney, upscaled nearest-neighbour, on black with arcade-colour backdrops.
  Traits: Practice (Corporate, Securities, Litigation, Contracts, Tax, IP, Regulatory, Arbitration, Bankruptcy,
  Admiralty), Headwear, Skin (6 tones + Chrome robot + Gold robot rare), Eyes (… Laser rare), Attire, Neckwear,
  Held (Gavel, Quill, Briefcase, Scales, Law book, Pen, None), Backdrop, Chambers (20 groups of 100: "Chambers I"..
  "Chambers XX"). 10 hand-tuned 1/1 "Founding Partners". Seeded, reproducible, no two identical.
- Counsel seats are paid in COMD: 80% of job revenue and the 1% Incorporations fee, split per epoch by accepted
  work (§7.4). Counsel bought by the Flywheel's floor sweeps are held in the Flywheel ("the firm's vault").

## 5. Agent identity (ERC-8004) — same as IMD
- Deploy the CC0 IdentityRegistry + ReputationRegistry (erc-8004-contracts, vendored at contracts/lib) on 4663.
- Holder registers their Counsel as an agent: `GET /agents/register-intent?tokenId=` returns calldata for
  `IdentityRegistry.register(agentURI)`; agentURI = `https://api.comd.fun/agents/by-token/${id}.json`;
  `POST /agents/bind`. An unregistered seat cannot connect (same as IMD). Accepted work → ReputationRegistry
  feedback, batched (`/feedback/batches`), documents at `/reviews/:hash.json`, `/work-records/:hash.json`,
  `/review-documents/:hash.json`.

## 6. Payments: x402 + Permit2 in $COMD (same flow as IMD, different asset)
- Every paid action costs `PRICE_COMD` (atomic, 18 decimals; default `100000000000000000000` = **100 COMD**,
  configurable by env): `job.open`, `job.continue`, `launch.open`, `workflow.open`, `oracle.request`;
  `schedule.create` and `schedule.topup` are priced per run.
- Flow identical to IMD docs: `GET /requests/capabilities`, `POST /requests/check`, `POST /requests/import`,
  `POST /requests/quote` (Bearer 32-byte token, requestKey idempotency), `POST /requests/:id/submit` → 402 with
  `PAYMENT-REQUIRED` (x402 v2, scheme exact, network `eip155:4663`, asset = the COMD token,
  `extra.assetTransferMethod:"permit2"`), then `PAYMENT-SIGNATURE` header + EIP-712 `QuoteApproval` (domain name
  "Company.md Paid Action", version "1"). The settler pays gas and settles via Permit2 `permitWitnessTransferFrom`
  (x402 exact-permit2 witness). `GET /requests/:id`, `GET /requests/paid-by/:address`, `GET /openapi.json`. Quotes
  live 600 s. Statuses quoted → payment_pending → admission_pending → admitted | payment_failed | expired.
- COMD has no transfer tax, so Permit2 moves the exact quoted amount.
- UI: "First, one approval. It lets Permit2 move up to 1,000 COMD, enough for ten requests, and costs gas once."
  A payer without COMD is sent to `/swap` (ETH → COMD through the official pool, 5% tax shown in the quote).
- payTo = `RevenueRouter`: anyone calls `distribute()` (the api keeper does it): **80% of the COMD goes to the
  RewardDistributor** (Counsel rewards, split by accepted work) and **20% to the firm treasury** (compute and gas).
  `setBps(rewardsBps)` owner-settable within 5,000–10,000. (IMD sends to a wallet; ours is on-chain and
  transparent.)

## 7. $COMD token, our pool and the Flywheel

### 7.1 Token
- `ComdToken` ("Company.md" / `COMD`): ERC-20 + ERC20Burnable + ERC20Permit, 18 decimals, fixed supply
  **1,000,000,000** minted once to the POL wallet; no mint function, no owner, **no transfer tax**.
- **100% of supply goes into liquidity**: one single-sided position (COMD only, from the minimum usable tick up to
  the opening tick) in our own COMD/ETH Uniswap v4 pool, held by the hook and **locked forever** (no function
  removes it). No team, treasury or reward allocation exists.

### 7.2 ComdTaxHook (our pool, tax only)
- Pool key: ETH (currency0) / COMD, LP fee 0, tick spacing 200. The tax is the only swap cost.
- Opening: the POL wallet calls `initializeAndSeed(initialMarketCapWei, comdAmount)` once — initialize and seed in
  **one transaction**; only the POL wallet can initialize, swaps revert until seeded (security review C-01), and
  third-party liquidity is refused.
- **Tax: 5% on every buy and sell, in ETH** (buy: 5% of the ETH paid; sell: 5% of the gross ETH out), forwarded
  to the Flywheel at once (or held as PoolManager claims and forwarded by the permissionless `flush()`). `taxBps`
  owner-settable, hard cap 500. Only the Flywheel's own buybacks through `ComdRouter` are exempt.
- `ComdRouter`: `swapExactETHForComd`, `swapExactComdForETH` (minOut + deadline), `quoteETHForComd`,
  `quoteComdForETH` (quotes net of tax). The site's Swap page uses it.

### 7.3 Flywheel (receives the 5% ETH tax)
Two buckets in bps of the tax, owner-settable summing to 10,000; default **50% buyback-and-burn / 50% Counsel floor
sweeps** (2.5% / 2.5% of volume).
- **Buyback-and-burn:** keeper `buyback(minOut)` swaps the bucket ETH → COMD through ComdRouter (untaxed) and burns
  it. The api keeper simulates and applies `KEEPER_BUYBACK_SLIPPAGE_BPS`.
- **Counsel floor sweep:** `sweep(adapter, data, tokenId, maxPrice)` (keeper/owner) buys a Company.md Counsel NFT
  from an allowlisted marketplace adapter (`IMarketplaceAdapter`: Seaport-style adapter, `MockMarketplace` on test
  chains), price ≤ `maxSweepPrice` (default 0.5 ETH). Swept Counsel stay in the Flywheel (the firm's vault); owner
  `awardSwept(tokenId, to)` re-issues them (e.g. to top counsel). `GET /flywheel/sweep-candidates` lists listings
  from `SWEEP_LISTINGS_URL`.
- Views for the website (`/flywheel`, `GET /flywheel`): `totalTaxIn`, `totalBoughtBack`, `totalBurned`,
  `totalSwept`, `sweptTokenIds`, `sweepSpent`, `bucketBalances` (buyback, sweep), `bps`; events `TaxIn`,
  `Buyback`, `Swept`, `SweptAwarded`.

### 7.4 Counsel rewards (RewardDistributor)
Weekly epochs from `REWARD_GENESIS`, paid in **COMD**: 80% of job revenue (RevenueRouter) and the 1% Incorporations
fee. The unallocated balance at epoch close is split among seats by accepted work in the epoch and posted as a
Merkle root (`postRoot(epoch, asset, root, total)`; leaf = keccak256(bytes.concat(keccak256(abi.encode(epoch,
tokenId, amount))))). Claims pay the current `ownerOf(tokenId)`. Epochs with work but no funds wait and post when
funds arrive. (The distributor also supports ETH roots, asset `address(0)`, unused by default.)

## 8. Launches (swarm launches) — same policy model as IMD
- Launch kinds: `custom_token`, `evm_project`, `univ4_hook`, `evm_contracts` (contracts only, no token).
- Launch policies (versioned rows, `GET /launch/policies`), params following the model IMD uses: chainId, feeTiers [500,3000,10000],
  rewardRule "equal_connected", totalSupply 1e27 (1B), treasuryBps 1000, liquidityBps 8000, contributorPoolBps
  1000, recentContributorBps 800, recentContributorWindowSeconds 43200|86400, contributorLockSeconds 3600,
  perWalletCapBps 3000, poolFloorBps 1000, gasCeilingWei, **pairedCurrencyAllowlist [ETH (0x0), COMD]**,
  initialMarketCaps / ranges per paired currency, owners {token, project, treasury, hookAdmin, lpPosition}.
- Swarm always takes 10% of a launched token: 2% split equally among wallets that worked on the launch, 8% split
  equally among seats connected in the recent window ("equal_connected"); per-wallet cap 30%; claim lock 1 h.
  `ContributorDistributor` (Merkle, per launch). Requester's 90%: `poolBps` 10–90% of supply seeds the pool, the
  wallet that pays gets the rest (UI default 88/2 as in IMD).
- `ProjectFactory` deploys a launch from the attested build: deterministic CREATE2, factory-only pool initialization
  (`LaunchGuardHook` or a launch hook), LP position to the policy owner, contributor allocation to the distributor.
  The Registrar runs `forge script` with its key (`REGISTRAR_ROLE`); gas ceiling enforced; `launch.json` schema
  `company.launch.v1` (a protocol identifier).
- Audit panel before any launch: 4 `audit-specialist` + `audit-judge` (planner adds them).
- Assurances (`/launches/:id/assurances`): outside audits/bounties recorded by admins.

## 9. Incorporations (Community Coins equivalent)
- Anyone launches a company coin for gas: 1B supply on a virtual constant-product curve **priced in COMD**, one
  shared COMD backing reserve. Users trade with ETH on the surface (`buyWithETH` / `sellForETH` route through
  ComdRouter, so that leg pays the 5% pool tax) or directly in COMD (`buyWithComd` / `sellForComd`).
- Fees per trade: 1% of the COMD side → Counsel rewards (RewardDistributor), 0.5% of the COMD side
  burned, 0.5% to the launcher (of the ETH side for ETH trades, pulled with `claimLauncherEth`; in COMD for COMD trades). Events
  carry `comdAmount`.
- Graduation to a v4 pool: not in V2 (documented deviation).

## 10. Work: skills, jobs, workflows, oracle, schedules, research, fuzz — same as IMD
- Skill catalog: IMD's 51 skill ids with the same roles (implement/review/tests/integrate/reference), inference
  tiers (economy/standard/premium) and requires (network, tool:image|audio|video), our own SKILL.md text, plus
  `eth-robinhood-chain` (`origin: comd`). Runnable vs reference split as in IMD docs. `GET /skills` live catalog,
  `/reads/:namespace/:name`. Seats read pinned inputs from `.company/reads/` (a protocol path).
- Job body, templates (single, impl_tests, impl_tests_review, multi_contract, fuzz, research), shapes (chain,
  fan_out_join, dag ≤6 steps), steps fields, inputs/outputs, references, github (filings in `comdfun`),
  sites (`ipfs` field kept for API parity but hosted on OUR storage, label → `https://<label>.sites.comd.fun`),
  onchain kinds, economics, research panels (panelSize/panelQuorum/minCitations/rubric), fuzz (runs 1e3–1e7).
- `job.continue` (parentJobId, only original payer, 403 payer_not_owner).
- Workflows: contracts → deployment → frontend → publishing → validating → completed|superseded|blocked|cancelled.
- Oracle: v1 body (question, chainId, window hours|blocks, answerType bool|address|bytes32|uint256|address[]|bytes32[],
  panelSize 5–100, quorum, validForSeconds, evidence chain|panel, head, definitions, guards, toleranceBps,
  consumer, allowAmbiguous); statuses assessing → reproducing → attested | disagreed | blocked | mismatch | refused
  | failed; EIP-712 `OracleAttestation` (domain "Company.md Oracle", version "1") signed by the attester;
  `/oracle/requests/:id/pools`.
- Schedules ("Retainers"): oracle.request or job.open, cadence {every ISO8601}|{cron,tz}, runs 1–1e6, label,
  continue, startAt; floors 10 min questions / 30 min jobs; statuses active|paused|exhausted|expired|cancelled;
  run statuses opened|skipped|failed|opening; three failures pause; top-up by any wallet; no refunds.
- Seats: one active device per NFT; pairing signs EIP-712 `WorkerAuthorization` (domain "Company.md Worker");
  device envelopes are Ed25519 over `comd.v2\n<KIND>\n<PAYLOAD_HASH>`; independent reviewers must use different
  wallets. **Premium work** (contracts that ship, frontends, websites) routes only to seats on a top-tier model at
  high effort (`effort` high | xhigh | max): Opus 5.5, Fable 5.1, GPT-6 Astra or GPT-6 class, configurable with
  `PREMIUM_MODELS`. The Managing Partner plans with `ORCHESTRATOR_RUNTIME` (default the Anthropic API).
  Earnings `/wallets/:address/earnings`.

## 11. Public API (control plane) — every IMD route, same shapes
Base: `https://api.comd.fun` and `wss://api.comd.fun/agent`. Routes exactly as IMD docs (see PARITY.md §API),
including `/version`, `/health`, `/services`, `/skills`, `/reads`, `/jobs*`, `/workflows*`, `/oracle/requests*`,
`/schedules*`, `/jobs/:id/panel|fuzz`, `/research/panels`, `/fuzz/results`, `/swarm`, `/workers*`,
`/contributors`, `/seats*`, `/wallets/:a/earnings`, `/publications*`, `/sites*`, `/launches*`,
`/launch/policies`, `/feedback/batches`, `/reviews|work-records|review-documents/:hash.json`, `/jobs/:id/records`,
`/jobs/:id/assessments`, `/requests/*`, `/pair*`, `/enrollments*`, `/agents/*`, `/bundles*`, `/artifacts*`,
`/sites/publish`, `/enrollments/revoke`, `/fuzz/result`, WS `/agent`. Additions: `GET /flywheel`,
`GET /flywheel/sweep-candidates` (tax buckets, burns, sweeps). ENS routes replaced by `/names` (our subdomain resolver) — `/ens*` return 404
feature_off. Payment asset COMD on `eip155:4663` (testnet `eip155:46630`), prices in COMD atomic units.

## 12. Deployment: Railway on comd.fun
- Two services from this repo: `web` (Next.js standalone, `infra/docker/web.Dockerfile`) on `comd.fun`, and `api`
  (`infra/docker/api.Dockerfile`: Chambers HTTP + WS, scheduler, attester, settler, keeper, and the Clerk / Records
  Office / Registrar in-process with git + Foundry) on `api.comd.fun` and the wildcard `*.sites.comd.fun`. Plus
  Railway Postgres and a volume at `/data` (or an S3-compatible bucket). `api` runs exactly one replica.
- Worker CLI tarball (`comd-worker.tgz` + `SHA256SUMS`) released by GitHub Actions to `comdfun/worker`.
- Contracts can be deployed from GitHub Actions (`.github/workflows/deploy-contracts.yml`: Deploy.s.sol, then
  SeedPool.s.sol, deployments JSON as an artifact, Railway env in the job summary) or from a laptop
  (`scripts/deploy-contracts.sh`).
- Mainnet launch order: deploy contracts → POL wallet seeds 100% of COMD into the pool atomically → open the free
  Counsel mint → start api and keeper → release the worker. Details: [DEPLOY.md](DEPLOY.md).

## 13. Changes from v1 (for readers of older notes)
- Payments: the v1 stablecoin payment path is removed entirely (no mock stablecoin, no stablecoin env); jobs are
  paid in COMD.
- Token: fixed 1B supply, 100% in locked liquidity (no team / treasury / reserve allocations).
- Pool: the v1 burn hook became ComdTaxHook (tax only); no capped inventory or trims, no buy wall, no staking
  (sCOMD) and no bond (removed by the owner in V5). `closeMarket` and `fundInventory` are not ported (the liquidity
  is locked forever).
- The Flywheel has no rewards bucket; seats are paid in COMD.
