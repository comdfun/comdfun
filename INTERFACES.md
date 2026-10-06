# >>> V4 (2026-10-06 10:15, FINAL for launch today; supersedes V2/V3 where they conflict) <<<

- **Jobs are paid in $COMD** (like IMD charges $IMD): x402 + Permit2, asset = COMD (18 dec), `PRICE_COMD` default
  100 COMD per action (per run for schedules). Approval copy: "First, one approval. It lets Permit2 move up to
  1,000 COMD, enough for ten requests, and costs gas once."
- payTo = `RevenueRouter` (COMD): default **80% to Counsel rewards** (RewardDistributor, asset COMD, split per epoch by
  accepted work) / **20% firm treasury** (compute + gas). Owner-settable bps.
- **USDG removed entirely** (no MockUSDG, no USDG env). `Bond` sells the 6% reserve for **ETH** at an owner-set
  `priceEth` (wei per 1 COMD) once enabled: `buyWithEth(uint256 minOut) payable`; proceeds to treasury.
- Tax 5% ETH → Flywheel 50% buyback-and-burn / 50% Counsel floor sweep. IMD POOL4 mechanics on the same pool
  (ComdTaxHook + BuyWall + StakedComd + RewardDripper + Bond) exactly as V3.
- Counsel seat rewards: COMD only (4.5% of trims + 80% of job revenue).
- Launch deadline: today. Prefer stability over new features.
- README media (produced by the web builder into `docs/media/`): intro.gif, hero.gif, flywheel.gif, home.png,
  retain.png, docket.png, matter.png, ruling.png, counsel.png, flywheel.png, vault.png (stake), docs.png, mobile.png;
  art builder already has packages/art/out/brand/* (copy x-header, logo-horizontal, contact-sheet into docs/media/).
- **Contract signatures as implemented (V4):**
  - `Bond` (key `bond`): `constructor(IERC20 comd, address treasury, uint256 priceEth, address owner)`,
    `priceEth()` (wei per 1e18 COMD), `quote(uint256 ethIn) view returns (uint256)`,
    `buyWithEth(uint256 minOut) payable returns (uint256)`, `reserve()`, `enabled()`, `treasury()`, `totalSold()`,
    `totalProceeds()`; owner `setEnabled(bool)`, `setPrice(uint256)`, `setTreasury(address)`; event
    `Bonded(address indexed buyer, uint256 ethIn, uint256 comdOut)`. Starts disabled.
  - `RevenueRouter` (key `revenueRouter`, COMD): `comd()`, `distribute() returns (uint256 toRewards, uint256 toTreasury)`
    (anyone), `bps() returns (uint16 rewardsBps, uint16 treasuryBps)` (8000/2000), `setBps(uint16 rewardsBps)`
    (5000–10000), `setTreasury(address)`; event `Distributed(uint256 total, uint256 toRewards, uint256 toTreasury)`.
  - deployments keys: `usdg` and `mockUsdg` removed; ABI package: `mockUSDGAbi` and `USDG_DECIMALS` removed.
  - Deploy env: `BOND_PRICE_WEI` (default 1e10 = the 10 ETH opening market cap price), `POL` (alias `POL_WALLET`);
    `USDG_ADDRESS` / `BOND_PRICE_USDG` removed. Scripts print JSON between `DEPLOYMENTS_JSON_BEGIN/END` and
    `SEED_JSON_BEGIN/END` for CI.

---

# >>> V3 (2026-10-06 09:15, supersedes V2 where they conflict) <<<

Owner corrections:
1. **Work is paid in USDG** (not COMD). x402 + Permit2 with asset USDG (6 decimals; MockUSDG on testnet/anvil),
   env `PRICE_USDG` (default 5 USDG = 5000000 per action, per run for schedules), `USDG_ADDRESS` is back.
   Approval copy: "First, one approval. It lets Permit2 move up to 50 USDG, enough for ten requests, and costs gas once."
   payTo = `RevenueRouter` (USDG): default **80% to Counsel rewards** (RewardDistributor, asset USDG, split per epoch
   by accepted work) / **20% firm** (compute + gas treasury). Owner-settable bps.
2. **5% tax** (ETH, every buy and sell in the official COMD/ETH pool) funds ONLY **buyback-and-burn and Counsel NFT
   floor sweeps**: default 50/50 (2.5% / 2.5% of volume), owner-settable. NO rewards bucket in the Flywheel.
3. **Restore IMD's POOL4 mechanics on the same pool**, combined with the tax (one hook, or hook + helper contracts
   if size requires):
   - Inventory cap + trim after swaps that push COMD above the cap (quote unchanged): trimmed COMD split **85% burn /
     6% bond reserve / 4.5% stakers (sCOMD via RewardDripper) / 4.5% Counsel seats (RewardDistributor, asset COMD)**.
     Cap ratchet scaled to 1B supply (defaults proportional to IMD: decay 100,000 COMD/day, floor 100,000 COMD;
     owner-tunable within bounds). Cap starts at the seeded inventory.
   - Buy wall: ETH freed by trims → standing bid below price, floor moves ≤ refStepTicks/day (security H-01 fix),
     keeper `rebalance()`, filled COMD through the same 85/6/4.5/4.5 split, keeper tip ≤1% capped 0.002 ETH.
   - `StakedComd` (sCOMD) ERC-4626 + `RewardDripper` (as before incl. M-02 hold fix, L-01 empty-vault fix).
   - `Bond`: sells the 6% reserve for USDG at owner-set `priceUsdg` once enabled; proceeds to the firm treasury.
4. Website: X link https://x.com/comdfun (NEXT_PUBLIC_X_URL default), contact team@comd.fun. Pages: /swap, /stake,
   /bond, /flywheel (tax buckets + IMD trim split + buy wall), docs updated.
5. Repo text: say "inspired by IMD (imd.fun)", never "copy/clone". Toolchain paths come from env vars (FORGE_BIN, SOLC_PATH, ANVIL_BIN, CHROMIUM_PATH) with PATH defaults.

**V3 contract signatures (final; contracts builder — ABIs in `@company/abi`):**
- `Flywheel`: `notifyTax() payable` (hook only), `buyback(uint256 minOut) returns (uint256 burned)` (keeper/owner),
  `sweep(address marketplaceAdapter, bytes data, uint256 tokenId, uint256 maxPrice) returns (uint256 spent)`,
  `awardSwept(uint256 tokenId, address to)` (owner), `setBps(uint16 buybackBps, uint16 sweepBps)` (sum 10000),
  views `bps() returns (uint16, uint16)` = (buybackBps, sweepBps), `bucketBalances() returns (uint256, uint256)` = (buyback ETH, sweep ETH),
  `totalTaxIn()`, `totalBoughtBack()`, `totalBurned()`, `totalSwept()`, `sweptTokenIds()`, `sweepSpent()`, `maxSweepPrice()`;
  events `TaxIn(uint256 eth)`, `Buyback(uint256 ethIn, uint256 comdBurned)`, `Swept(uint256 tokenId, uint256 price)`,
  `SweptAwarded(uint256 indexed tokenId, address indexed to)`, `BpsSet(uint16 buybackBps, uint16 sweepBps)`.
  REMOVED: `distribute()`, `totalRewards()`, `rewardsBucket`, `RewardsSent`.
- `ComdTaxHook` (key name `comdTaxHook`; one hook = tax + capped inventory): V2 functions plus `inventory()`, `cap()`,
  `currentCap()`, `lastInventory()`, `params() returns (Params{capFloor, capDecayPerDay, burnBps, bondBps, stakersBps,
  seatsBps, refStepTicks})`, `stats() returns (Stats{trimmedComd, trimmedEth, split, burned, toBond, toStakers, toSeats})`,
  `claimEth()`, `claimComd()`, `refTick()`, `observe()`, `split(uint256)` (BuyWall only), `buyWall()`, `bond()`,
  `dripper()`, `distributor()`; owner `setParams`, `setDestinations`, `setBuyWall` (once); events `CapUpdated(uint256 cap,
  uint256 inventory)`, `Trimmed(uint256 excess, uint128 liquidityRemoved, uint256 ethOut, uint256 comdOut)`,
  `Split(uint256 amount, uint256 burned, uint256 toBond, uint256 toStakers, uint256 toSeats)`,
  `Flushed(uint256 tax, uint256 trimEth, uint256 trimComd)`.
- `BuyWall` (key `buyWall`): `rebalance() returns (uint256 tip)`, `canRebalance() view returns (bool)`,
  `wallAmounts(uint160 sqrtPriceX96) view returns (uint256 eth, uint256 comdBought)`, `wallLiquidity()`, `wallLower()`,
  `wallUpper()`, `floorTick()`, `previewFloorTick()`, `parkedEth()`, `wallEthPosted()`, `totalWallBought()`,
  `totalTips()`, `params()`; events `WallPosted(int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 eth)`,
  `WallClosed(uint256 ethOut, uint256 comdBought)`, `WallParked(uint256 eth, int24 floorTick, int24 currentTick)`,
  `Rebalanced(address indexed keeper, uint256 ethHandled, uint256 tip)`.
- `StakedComd` (sCOMD, key `stakedComd`): ERC-4626 + `heldShares(address)`, `lastDepositBlock(address)`.
  `RewardDripper` (key `rewardDripper`): `ratePerSecond()`, `streamCapPerDay()`, `pending()`, `drip()`,
  `notifyReward(uint256)`. `Bond` (key `bond`): `enabled()`, `priceUsdg()` (USDG atomic per 1 COMD), `reserve()`,
  `quote(uint256 usdgIn)`, `buyWithUsdg(uint256 usdgIn, uint256 minOut) returns (uint256)`, `treasury()`.
- `RevenueRouter` (USDG): `distribute() returns (uint256 toRewards, uint256 toTreasury)` (anyone),
  `bps() returns (uint16 rewardsBps, uint16 treasuryBps)` (default 8000/2000), `setBps(uint16 rewardsBps)` (5000–10000),
  `setTreasury(address)`, `usdg()`, `treasury()`, `rewardDistributor()`; event `Distributed(uint256 total,
  uint256 toRewards, uint256 toTreasury)`.
- `Incorporations`: as V2 (COMD), but the 1% fee goes to sCOMD stakers via `RewardDripper.notifyReward`;
  `Fees(address indexed coin, uint256 toStakers, uint256 burned, uint256 launcherComd, uint256 launcherEth)`.
- deployments keys add: `usdg`, `mockUsdg`, `stakedComd`, `rewardDripper`, `bond`, `buyWall`.

---

# >>> V2 (2026-10-06, supersedes anything below that conflicts) <<<

**Brand:** product name **Company.md** (always written exactly so; the firm, "Company.md counsel"), token **$COMD**,
domain **comd.fun** (web `https://comd.fun`, API `https://api.comd.fun`, hosted sites `https://<label>.sites.comd.fun`),
contact **team@comd.fun**. CLI binary `comd` (config `~/.comd/`), GitHub org for swarm output `comd-filings`, worker
release repo `comd-fun/worker`. NFT collection "Company.md Counsel" / symbol `COUNSEL`, items "Counsel #0042".
Internal npm scope stays `@company/*` (not user-facing). No old brand names, "$COMPANY", "USDG payments",
"sCOMPANY", "Trust" (as product), "Bond" anywhere user-facing.

**Payments:** jobs are paid in **$COMD** (18 decimals) via x402 + Permit2 exactly as before (asset = COMD token).
Price env `PRICE_COMD` (atomic, default `100000000000000000000` = 100 COMD) per action; per run for schedules.
UI approval copy: "First, one approval. It lets Permit2 move up to 1,000 COMD, enough for ten requests, and costs gas once."
payTo = RevenueRouter: COMD received is split 50% burned / 50% to RewardDistributor (Counsel rewards), bps owner-settable.

**Token & flywheel:** `ComdToken` ERC20 "Company.md"/"COMD", 18 dec, ERC20Permit + Burnable, fixed supply
1,000,000,000 minted once to the POL/deployer; **100% of supply goes into liquidity** (single-sided v4 position in
the COMD/ETH pool). No transfer tax at token level (wallet transfers and Permit2 payments are untaxed).
`ComdTaxHook`: Uniswap v4 hook on the official COMD/ETH pool taking a **5% tax on every buy and sell, in ETH**
(buy: 5% of ETH in; sell: 5% of ETH out), forwarded to `Flywheel`. `taxBps` owner-settable, hard cap 500. Only the POL
wallet can initialize the pool; swaps revert until `seed` (security C-01 lesson); third-party liquidity in this pool
blocked.
`Flywheel` (receives the ETH tax): buckets in bps of the tax (default **buyback 4000 / floor sweep 3000 / rewards
3000** = 2% / 1.5% / 1.5% of volume), owner-settable summing to 10000.
- Buyback: keeper `buyback(uint256 minOut)` swaps the buyback bucket ETH→COMD through ComdRouter (tax-exempt path for
  the flywheel itself) and burns it.
- Floor sweep: ETH accrues in the sweep bucket; keeper/owner `sweep(address marketplaceAdapter, bytes data,
  uint256 tokenId, uint256 maxPrice)` buys a Company.md Counsel NFT from an allowlisted marketplace adapter
  (`IMarketplaceAdapter.buy(...)`, Seaport-style adapter + mock), price ≤ `maxSweepPrice`; swept NFTs are held by the
  Flywheel ("the firm's vault"); owner `awardSwept(tokenId, to)` re-issues them (e.g. to top counsel). Emits `Swept`.
- Rewards: `distribute()` sends the rewards bucket ETH to RewardDistributor (asset address(0) = ETH) for Counsel epochs
  (split by accepted work).
- Views for the website: `totalTaxIn()`, `totalBoughtBack()` (ETH spent), `totalBurned()` (COMD), `totalSwept()`
  (count), `sweptTokenIds()`, `sweepSpent()`, `totalRewards()` (ETH), `bucketBalances() returns (uint256 buyback,
  uint256 sweep, uint256 rewards)`, `bps() returns (uint16,uint16,uint16)`, events `TaxIn(uint256 eth)`,
  `Buyback(uint256 ethIn, uint256 comdBurned)`, `Swept(uint256 tokenId, uint256 price)`, `RewardsSent(uint256 eth)`.
- REMOVED: CompanyBurnHook, CompanyHookLens, StakedCompany, RewardDripper, Bond (no staking, no bonds).

**Contract functions (fixed names, replacing the V1 list for these contracts):**
- ComdRouter: `swapExactETHForComd(uint256 minOut, address to, uint256 deadline) payable returns (uint256)`,
  `swapExactComdForETH(uint256 amountIn, uint256 minOut, address to, uint256 deadline) returns (uint256)`,
  `quoteETHForComd(uint256 ethIn) returns (uint256)`, `quoteComdForETH(uint256 amountIn) returns (uint256)`
  (quotes are net of the 5% tax).
- RewardDistributor: `claim(epoch, tokenId, amount, proof)` (COMD), `claimToken(address asset, ...)` incl.
  asset address(0) for ETH; leaf unchanged.
- Incorporations: `buyWithComd`, `sellForComd`, `buyWithETH`, `sellForETH`, `quoteBuy`, `quoteSell`, events with
  `comdAmount` (renamed from companyAmount). Coins are priced in COMD.
- CounselNFT: unchanged (free mint: price 0).
- Launch pairing allowlist: ETH, COMD.

**Signing domains:** "Company.md Worker", "Company.md Paid Action", "Company.md Oracle"; device envelope prefix `comd.v2`.

**Env renames:** `COMD_TOKEN` (was COMPANY_TOKEN), `PRICE_COMD` (was PRICE_USDG), `FLYWHEEL`, `COMD_ROUTER`,
`COMD_TAX_HOOK`; `USDG_ADDRESS` removed; `SITES_DOMAIN=sites.comd.fun`; `PUBLIC_WEB_URL=https://comd.fun`;
`PUBLIC_API_URL=https://api.comd.fun`; `CONTACT_EMAIL=team@comd.fun`.


---

# Cross-package interfaces (binding for all builders)

Repo: npm workspaces, Node 22, TypeScript ESM. Package names `@company/*`.

| Path | Package | Owner |
|---|---|---|
| contracts/ | Foundry | contracts builder |
| packages/abi | `@company/abi` — generated ABIs + per-chain address book (`addresses.ts`, filled by deploy scripts / env) | contracts builder |
| packages/protocol | `@company/protocol` — types, canonical JSON, Ed25519 envelopes, EIP-712 types, WS frames, Merkle | backend builder |
| packages/art | `@company/art` — pixel Counsel generator, logo, icons | art builder |
| packages/services | `@company/services` — clerk/verifier, records office/publisher, registrar/deployer, storage | services builder |
| skills/ | 51 SKILL.md folders (IMD ids, our text) + `skills/index.json` | services builder |
| apps/api | `@company/api` — control plane HTTP + WS + scheduler + attester + settler | backend builder |
| apps/worker | `@company/worker` — `company` CLI | backend builder |
| apps/web | `@company/web` — Next.js site, docket (explorer), retain flow, trust, incorporations, docs, mint | web builder |
| infra/ | Dockerfiles, railway.json, GH Actions | integrator |

## Contract functions the web/api call (names and signatures are fixed)
- CounselNFT: `MAX_SUPPLY() view returns (uint256)`, `totalSupply() view`, `price() view`, `phase() view returns (uint8)` (0 closed,1 allowlist,2 public), `maxPerWallet() view`, `mintedBy(address) view returns (uint256)`, `mint(uint256 quantity) payable`, `allowlistMint(uint256 quantity, bytes32[] proof) payable`, ERC-721 + `tokenURI`.
- ERC-8004 IdentityRegistry (vendored CC0): `register(string agentURI) returns (uint256 agentId)` (use the vendored signature if it differs, and document it in packages/abi/README.md), `ownerOf`, `tokenURI`.
- CompanyToken: ERC-20 + `burn`, `permit`.
- CompanyRouter: `swapExactETHForCompany(uint256 minOut, address to, uint256 deadline) payable returns (uint256)`, `swapExactCompanyForETH(uint256 amountIn, uint256 minOut, address to, uint256 deadline) returns (uint256)`, `quoteETHForCompany(uint256 ethIn) returns (uint256)`, `quoteCompanyForETH(uint256 amountIn) returns (uint256)` (non-view quoter style acceptable; document).
- StakedCompany: ERC-4626 (`deposit`, `redeem`, `withdraw`, `convertToAssets`, `totalAssets`, `previewDeposit`). RewardDripper: `ratePerSecond() view`, `streamCapPerDay() view`, `pending() view`.
- Bond: `enabled() view returns (bool)`, `priceUsdg() view` (USDG 6-dec per 1 COMPANY), `reserve() view`, `buyWithUsdg(uint256 usdgIn, uint256 minOut) returns (uint256)`.
- RewardDistributor: `claim(uint256 epoch, uint256 tokenId, uint256 amount, bytes32[] proof)`; leaf `keccak256(bytes.concat(keccak256(abi.encode(epoch, tokenId, amount))))`; `claimed(uint256 epoch, uint256 tokenId) view`.
- ContributorDistributor: `claim(uint256 launchId, address account, uint256 amount, bytes32[] proof)`; leaf `keccak256(bytes.concat(keccak256(abi.encode(launchId, account, amount))))`; `unlockAt(uint256 launchId) view`.
- Incorporations: `create(string name, string symbol, string metadataURI) returns (address coin)`, `buyWithCompany(address coin, uint256 companyIn, uint256 minOut) returns (uint256)`, `sellForCompany(address coin, uint256 amountIn, uint256 minCompanyOut) returns (uint256)`, `buyWithETH(address coin, uint256 minOut) payable returns (uint256)`, `sellForETH(address coin, uint256 amountIn, uint256 minEthOut) returns (uint256)`, `quoteBuy(address coin, uint256 companyIn) view`, `quoteSell(address coin, uint256 amountIn) view`, `coins(uint256) view`, `coinCount() view`, events `CoinCreated(address indexed coin, address indexed creator, string name, string symbol, string metadataURI)`, `Trade(address indexed coin, address indexed trader, bool isBuy, uint256 companyAmount, uint256 coinAmount, uint256 ethAmount)`.
- RevenueRouter (payTo for USDG): `distribute()` keeper, `bps()` views.
- CompanyBurnHook (keeper/admin, not called by web): `rebalance() returns (uint256 tip)`, `flush()` (unchanged). **Changed by the security review:** owner-only `fundInventory(uint256 companyAmount, int24 minTick, int24 maxTick) payable` (was `fundInventory(uint256)`; reverts `PriceOutOfBounds()` unless the pool tick is in `[minTick, maxTick]`). Swaps revert `NotSeeded()` until `seed`.
- StakedCompany hold (security review M-02): only shares minted in the current block are held; a same-block `redeem`/`withdraw` of them reverts with the ERC-4626 `ERC4626ExceededMaxRedeem`/`ERC4626ExceededMaxWithdraw` (transfers: `SameBlockHold()`); `maxRedeem`/`maxWithdraw` exclude them (and are 0 while paused). New view `heldShares(address)`.
- ProjectFactory: used only by the registrar service; ABI exported.
- OracleAttestation (EIP-712, domain name "Company.md Oracle", version "1"): `OracleAttestation(bytes32 requestId,uint256 chainId,bytes32 questionHash,string answerType,bytes answer,uint256 figure,uint256 fromBlock,uint256 toBlock,bytes32 blockHash,bytes32 panelJobId,uint64 issuedAt,uint64 expiresAt)`; library `OracleAttestationVerifier`.

## Signing domains (off-chain)
- WorkerAuthorization: domain `{name:"Company.md Worker", version:"1", chainId}`; fields deviceKey (bytes32), wallet, tokenId, nonce (bytes32), expiresAt (uint64), relayOrigin (string).
- QuoteApproval: domain `{name:"Company.md Paid Action", version:"1", chainId}`; fields as IMD docs (resource, requesterScopeHash, quoteId, quoteHash, paymentHash, action, asset, amount, payTo, expiresAt).
- Device envelopes: Ed25519 over `company.v2\n<KIND>\n<PAYLOAD_HASH>`; frames signed the same way.

## HTTP API
Identical routes, params and response shapes to https://imd.fun/docs/ (read it), with: payment asset USDG on
eip155:4663 (testnet eip155:46630), prices in USDG atomic units (6 decimals), `ipfs` → our site hosting
(`site: {label, url}`), ENS routes replaced by `GET /names` and `GET /names/:label`. The web app reads ONLY these
routes (plus chain reads via viem). Base URL from `NEXT_PUBLIC_API_URL`.

## Art
`@company/art`: `renderCounsel(tokenId:number, opts?:{size?:number}) => { svg: string, attributes: {trait_type,value}[], name: string }`,
`renderCounselPNG(tokenId, scale) => Buffer` (pure JS PNG encoder, no native deps), `logoSvg()`, `icons` map of
16×16 pixel icons as SVG strings: scales, gavel, column, quill, seal, briefcase, clock, document, eye, coin, chain,
image, audio, video, report, audit, website, hook, token, contracts, heartbeat, oracle, company. Deterministic.

## Env names (shared)
`CHAIN_ID`, `RPC_URL`, `PUBLIC_API_URL`, `PUBLIC_WEB_URL`, `SITES_DOMAIN`, `DATABASE_URL`, `STORAGE_DRIVER`
(local|s3), `STORAGE_DIR`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL`,
`ATTESTER_PRIVATE_KEY`, `SETTLER_PRIVATE_KEY`, `DEPLOYER_PRIVATE_KEY`, `GITHUB_TOKEN`, `GITHUB_ORG`,
`PAYTO_ADDRESS`, `USDG_ADDRESS`, `PERMIT2_ADDRESS`, `PRICE_USDG` (atomic), addresses `COUNSEL_NFT`, `COMPANY_TOKEN`,
`IDENTITY_REGISTRY`, `REPUTATION_REGISTRY`, `PROJECT_FACTORY`, `REWARD_DISTRIBUTOR`, `CONTRIBUTOR_DISTRIBUTOR`,
`ORCHESTRATOR_RUNTIME` (claude|codex|anthropic-api), `ANTHROPIC_API_KEY` (Managing Partner planning).
