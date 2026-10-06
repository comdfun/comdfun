# Company.md — contracts

> ## ⚠ UNAUDITED — EXPERIMENTAL
> None of these contracts has been audited by an outside firm (see `SECURITY_REVIEW.md` for the internal reviews).
> A bug in the hook, the buy wall, the Flywheel, the vault, the distributors, the factory or the launchpad can lose
> every asset they hold. Owner and keeper keys hold real powers (listed below). Deploy to testnet (46630) first;
> deploy to mainnet (4663) only after an outside audit. Not affiliated with Robinhood. The pool mechanics are inspired
> by IMD's POOL4 (imd.fun).

Solidity 0.8.26, OpenZeppelin 5.4, Uniswap v4-core, Foundry. License MIT (vendored ERC-8004 registries: CC0;
v4-core `PoolManager`: BUSL-1.1 — only deployed by us in tests and on testnet when no `POOL_MANAGER` is given).

## How value moves

```
                     official COMD/ETH v4 pool (ComdTaxHook, 100% of supply seeded single-sided)
  every buy/sell ──► 1) 5% ETH tax ─────────────► Flywheel: 50% buyback-and-burn (untaxed route) / 50% Counsel floor sweep
                     2) inventory cap: COMD above the cap is trimmed after the swap (quote unchanged)
                          trimmed COMD ─► 85% burn / 6% Bond / 4.5% RewardDripper → sCOMD / 4.5% RewardDistributor (seats)
                          trimmed ETH  ─► BuyWall: standing ETH bid below the price; COMD it buys → same 85/6/4.5/4.5 split
  job payments (x402 + Permit2, COMD) ─► RevenueRouter: 80% RewardDistributor (Counsel, COMD) / 20% firm treasury
  Bond: sells its COMD reserve for ETH at the owner price (`priceEth`) once enabled → firm treasury
```

## Contracts

| Contract | File | What it does |
|---|---|---|
| `ComdToken` | `src/ComdToken.sol` | $COMD "Company.md": ERC-20 + Burnable + Permit, 1,000,000,000 minted once to the POL wallet. No mint, owner or transfer tax. |
| `ComdTaxHook` | `src/ComdTaxHook.sol` | v4 hook of the official pool (ETH/COMD, LP fee 0, tick spacing 200, flags `0x18CC`). Atomic `initializeAndSeed`; 5% ETH tax on all 4 swap kinds → Flywheel; inventory cap + post-swap trims + 85/6/4.5/4.5 split; cap ratchet; block-lagged reference tick; ERC-6909 claim fallback + `flush()`. Holds the main position, which no function can remove. |
| `BuyWall` | `src/BuyWall.sol` | The protocol's standing ETH bid on the same pool (the only LP besides the hook). Keeper `rebalance()`: close, split filled COMD via the hook, re-post at the bounded floor, capped tip. |
| `ComdRouter` | `src/ComdRouter.sol` | ETH↔COMD exact-input swaps (`minOut`, deadline), amounts net of tax; attests its caller in hookData (Flywheel exemption). Non-view quoters. |
| `Flywheel` | `src/Flywheel.sol` | Tax buckets buyback / sweep (default 50/50). Keeper `buyback(minOut)` (burns), keeper `sweep(...)` (Counsel NFTs via allowlisted adapters, ≤ `maxSweepPrice`), owner `awardSwept`. |
| `StakedComd` | `src/StakedComd.sol` | sCOMD: ERC-4626 over COMD, decimals offset 6, no lock, same-block hold only on freshly minted shares (M-02), pause, sweep non-COMD only. |
| `RewardDripper` | `src/RewardDripper.sol` | Streams staker COMD into sCOMD: `rate = min(streamCapPerDay (8.64M/day), balance/30d)`, 1 h catch-up, nothing streams into an empty vault (L-01). |
| `Bond` | `src/Bond.sol` | Sells its COMD (6% of trims) for ETH at `priceEth` (wei per 1e18 COMD) via `buyWithEth(minOut)` once `enabled`; ETH goes straight to the firm treasury. |
| `RevenueRouter` | `src/RevenueRouter.sol` | payTo of job payments (COMD): `distribute()` (anyone) 80% RewardDistributor / 20% treasury. |
| `RewardDistributor` | `src/RewardDistributor.sol` | Counsel rewards: one Merkle root per (epoch, asset) — COMD (trims + 80% of job revenue); ETH (`address(0)`) also supported; claims pay the current seat owner; a root never pays more than its total. |
| `CounselNFT` | `src/CounselNFT.sol` | "Company.md Counsel" (COUNSEL), 2,000 seats. |
| ERC-8004 registries | `lib/erc-8004-contracts` (CC0) | Behind ERC1967 proxies via `ERC8004Bootstrap`. |
| `Incorporations` | `src/Incorporations.sol` | Company coins on a COMD curve; fees 1% → sCOMD stakers (dripper), 0.5% burn, 0.5% launcher; ETH legs through ComdRouter (taxed). |
| `ProjectFactory` & launch contracts | `src/launch/` | Swarm launches; pairing allowlist ETH, COMD. |
| `IMarketplaceAdapter`, `MockMarketplace`, `SeaportAdapter` | | Floor-sweep adapters (mock = test chains; Seaport = untested skeleton needing marketplace calldata). |
| `OracleAttestationVerifier` | `src/oracle/` | EIP-712 "Company.md Oracle". |

## Official pool mechanics

1. **Opening.** POL calls `ComdTaxHook.initializeAndSeed(initialMarketCapWei, comdAmount)` once: the hook initializes
   its own pool at `floor(openingTick, 200)` and deposits the COMD in `[minUsableTick, openTick]` in the same
   transaction. External `initialize` with this hook always reverts. The cap starts at the seeded inventory.
2. **Tax first.** 5% (max 5%) of the ETH a buyer pays / of the gross ETH a seller receives, on all four swap kinds;
   beforeSwap-charged kinds must fill completely. Forwarded to the Flywheel, or ERC-6909 claims + `flush()` when the
   PoolManager does not hold the ETH yet. Exempt only: the Flywheel's buyback through the official ComdRouter.
3. **Then the cap.** After every swap, if the main position holds more COMD than `currentCap()`, the excess fraction of
   its liquidity is removed (price and swapper's delta untouched). The cap never rises by itself; it decays at most
   `capDecayPerDay` (100,000 COMD/day) toward max(`capFloor` 100,000 COMD, inventory after the previous swap). Because
   the seed is single-sided at the opening price, inventory can never exceed the seed: trims start once the cap has
   decayed below the inventory that sells bring back (net selling after the room opened by buys has closed).
4. **Splits.** 85% burned / 6% Bond / 4.5% RewardDripper / 4.5% RewardDistributor; burn absorbs rounding. Trimmed ETH
   → BuyWall (claims until a BuyWall is set).
5. **BuyWall.** ETH-only position above the tick at `ceil(floor)`, width 4,000 ticks. Floor target = hook `refTick`
   (moves ≤ 200 ticks per parent-chain block toward the closing tick of earlier blocks) + 200 ticks; the floor moves
   ≤ 400 ticks/day in both directions (toward the price ≤ one day's allowance per update — H-01). `rebalance()` when
   new ETH ≥ 0.1 ETH, fill ≥ 10,000 COMD, or parked ETH can be posted; tip min(1% of ETH handled, 0.002 ETH).
6. LP fee is 0: the tax is the only swap cost; there are no LP fees to collect.

## Owner / keeper powers

| Contract | Holder | Powers | Cannot | Renounce |
|---|---|---|---|---|
| `ComdTaxHook` | Ownable2Step | `setTaxBps` (0–500); `setParams` (cap floor 1,000–100M COMD, decay ≤ 1M COMD/day, burn ≥ 50% & each other leg ≤ 25% & sum 100%, ref step 1–2,000 ticks); `setDestinations` (bond / dripper / distributor — redirects the 15% non-burn split); `setRouter`, `setBuyWall` (once) | remove liquidity, change the Flywheel, take tax/trims | yes |
| `BuyWall` | Ownable2Step | `setParams` (floor decay 1–2,000 ticks/day, gap ≤ 5,000, width 200–50,000, threshold 0.001–10 ETH, min fill 1–100M COMD, tip ≤ 1% & ≤ 0.002 ETH) | withdraw the wall or its ETH | yes |
| `BuyWall` | anyone (keeper) | `rebalance()` for the capped tip | choose prices | — |
| `Flywheel` | Ownable2Step / keeper | owner: bucket bps (sum 10,000), `maxSweepPrice`, adapters, keeper, `awardSwept`, hook/router once; keeper (or owner): `buyback(minOut)` slippage, `sweep` listing choice within caps | withdraw bucket ETH | yes |
| `StakedComd` | Ownable2Step | pause/unpause (freezes withdrawals); sweep non-COMD tokens | move staked COMD; renounce while paused | yes |
| `RewardDripper` | Ownable2Step | stream params within bounds; re-point the vault | renounce without a vault | yes |
| `Bond` | Ownable2Step | enable/disable, `setPrice` (> 0 — no lower bound: the owner could price the reserve near zero and buy it, review L-05), treasury | withdraw the reserve directly | yes |
| `RevenueRouter` | Ownable2Step | `setBps(rewardsBps)` 5,000–10,000; `setTreasury` | send COMD revenue elsewhere | yes |
| `RewardDistributor` | admin / SETTLER | roots within the unallocated balance; expire after 365 d | over-pay a root | yes |
| others | — | as before (CounselNFT, ProjectFactory, Incorporations `virtualComd`, ERC-8004 upgrades) | | |

Not ported from IMD/V1 on purpose: `closeMarket` (escape hatch) and `fundInventory` — the seeded liquidity is locked
forever, so no key can pull it (and no defect can be remedied by moving it).

## Build and test

```bash
cd contracts
# dependencies (lib/ is git-ignored)
git clone --depth 1 --branch v1.17.0 https://github.com/foundry-rs/forge-std lib/forge-std
git clone --depth 1 --branch v5.4.0 https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts
git clone --depth 1 --branch v5.4.0 https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable lib/openzeppelin-contracts-upgradeable
git clone https://github.com/Uniswap/v4-core lib/v4-core && (cd lib/v4-core && git checkout 46c6834698c48bc4a463a86d8420f4eb1d7f3b75 && git submodule update --init lib/solmate)
git clone https://github.com/erc-8004/erc-8004-contracts lib/erc-8004-contracts && (cd lib/erc-8004-contracts && git checkout b9e466c250744a7e06b13dff9d3c2844ed64f825)

forge test                                                   # downloads solc 0.8.26
FOUNDRY_SOLC=$SOLC_PATH FOUNDRY_OFFLINE=true forge test      # offline, with a local solc 0.8.26 binary
```

## Deploy (CLI)

```bash
cd contracts
export RPC_URL=https://rpc.testnet.chain.robinhood.com      # mainnet: https://rpc.mainnet.chain.robinhood.com
export DEPLOYER_PRIVATE_KEY=0x...
export ADMIN=0x... POL=0x... TREASURY=0x... SETTLER=0x... KEEPER=0x... REGISTRAR=0x...
# test chains: POOL_MANAGER optional (a v4 PoolManager is deployed if unset); mainnet default 0x8366…40951
# optional: BOND_PRICE_WEI (wei per 1e18 COMD, default 1e10), MAX_SWEEP_PRICE, SEAPORT, COUNSEL_BASE_URI
forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --broadcast --slow
(cd ../packages/abi && npm run gen)
```

`deployments/<chainId>.json` keys: `chainId, deployedAtBlock, admin, pol, treasury, weth, permit2, poolManager,
deployedPoolManager, stakedComd, rewardDripper, bond, buyWall, create2Deployer, comdToken,
counselNFT, identityRegistry, reputationRegistry, rewardDistributor, revenueRouter, flywheel, comdTaxHook, comdRouter,
projectFactory, contributorDistributor, launchGuardHook, mockMarketplace, seaportAdapter, incorporations`.

Then:
1. `ADMIN` calls `acceptOwnership()` on `ComdTaxHook` and `Flywheel` (the deployer did their one-time wiring first).
2. POL opens the market with 100% of the supply (approve + atomic `initializeAndSeed`):
   ```bash
   export POL_PRIVATE_KEY=0x... HOOK=<comdTaxHook> INITIAL_MARKET_CAP_WEI=10000000000000000000
   forge script script/SeedPool.s.sol:SeedPool --rpc-url $RPC_URL --broadcast
   ```
3. API env: `PAYTO_ADDRESS=revenueRouter`, `COMD_TOKEN`, `COMD_ROUTER`, `COMD_TAX_HOOK`, `FLYWHEEL`.
4. Keepers: `BuyWall.rebalance()` when `canRebalance()`, `ComdTaxHook.flush()` when claims are pending,
   `RewardDripper.drip()` at least hourly, `Flywheel.buyback(minOut)` / `sweep(...)`, `RevenueRouter.distribute()`.

### Deploy from CI (GitHub Actions, env only)

Both scripts read everything from the environment (no prompts, no input files) and print machine-readable JSON to
stdout between markers, so a workflow can capture it without reading files:

| Script | Required env | Optional env | Stdout markers |
|---|---|---|---|
| `Deploy.s.sol:Deploy` | `RPC_URL`, `DEPLOYER_PRIVATE_KEY` (+ `POOL_MANAGER` on chains other than 4663/46630/31337) | `ADMIN` (default deployer), `POL` (alias `POL_WALLET`, default ADMIN), `TREASURY`, `SETTLER`, `KEEPER`, `REGISTRAR` (default ADMIN), `BOND_PRICE_WEI` (1e10), `MAX_SWEEP_PRICE` (0.5 ether), `SEAPORT`, `COUNSEL_BASE_URI`, `WRITE_DEPLOYMENTS` (true; creates `deployments/` if missing) | `DEPLOYMENTS_JSON_BEGIN` / `DEPLOYMENTS_JSON_END` |
| `SeedPool.s.sol:SeedPool` | `RPC_URL`, `POL_PRIVATE_KEY`, `HOOK` (= `comdTaxHook`) | `INITIAL_MARKET_CAP_WEI` (10 ether), `SEED_COMD` (whole POL balance) | `SEED_JSON_BEGIN` / `SEED_JSON_END` |

For production, set every role explicitly (`ADMIN`, `POL`, `TREASURY`, `KEEPER`, `SETTLER`, `REGISTRAR`) as
repository secrets/variables; leaving them unset makes the deployer hold the role.

```yaml
# .github/workflows/deploy.yml (sketch)
- uses: foundry-rs/foundry-toolchain@v1
- run: forge install   # or checkout with submodules
  working-directory: contracts
- name: Deploy
  working-directory: contracts
  env:
    RPC_URL: ${{ secrets.RPC_URL }}
    DEPLOYER_PRIVATE_KEY: ${{ secrets.DEPLOYER_PRIVATE_KEY }}
    ADMIN: ${{ vars.ADMIN }}
    POL: ${{ vars.POL }}
    TREASURY: ${{ vars.TREASURY }}
    KEEPER: ${{ vars.KEEPER }}
    SETTLER: ${{ vars.SETTLER }}
    REGISTRAR: ${{ vars.REGISTRAR }}
  run: |
    forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" --broadcast --slow | tee deploy.log
    sed -n '/DEPLOYMENTS_JSON_BEGIN/,/DEPLOYMENTS_JSON_END/p' deploy.log | sed '1d;$d' | sed 's/^ *//' > deployment.json
    echo "HOOK=$(jq -r .comdTaxHook deployment.json)" >> "$GITHUB_ENV"
- name: Seed pool (after ADMIN accepted ownership of ComdTaxHook and Flywheel)
  working-directory: contracts
  env:
    RPC_URL: ${{ secrets.RPC_URL }}
    POL_PRIVATE_KEY: ${{ secrets.POL_PRIVATE_KEY }}
    INITIAL_MARKET_CAP_WEI: ${{ vars.INITIAL_MARKET_CAP_WEI }}
  run: forge script script/SeedPool.s.sol:SeedPool --rpc-url "$RPC_URL" --broadcast
```

Seeding does not depend on the ownership acceptance (the hook's `initializeAndSeed` is POL-only), so both steps can
run in one workflow; `ADMIN` still has to call `acceptOwnership()` on both contracts.

### External address checklist (mainnet)

- [ ] `eth_chainId` = `0x1237` (4663).
- [ ] v4 PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951`: verified Uniswap v4 source.
- [ ] Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3` (x402 settlement, off-chain). WETH / UniversalRouter not used.
- [ ] Hook address low bits `0x18CC`; LaunchGuardHook `0x2000`.
- [ ] `ADMIN` multisig (+ timelock); POL / SETTLER / KEEPER / REGISTRAR separate wallets.

## Known limitations

- **Unaudited.** See `SECURITY_REVIEW.md` §V3.
- Liquidity locked forever (no escape hatch). Trims only begin after the cap decays below re-filled inventory; with
  100% of supply seeded and a 100,000 COMD/day decay this takes time after large buys (by design, proportional to IMD).
- Single venue: the tax and trims apply in the official pool only; other COMD pools (with their own liquidity) are
  possible and untaxed.
- Keeper trust (buyback slippage, sweep choice); owner can redirect the 15% non-burn split (`setDestinations`) and
  set the Bond price (L-05). Put `ADMIN` behind a multisig + timelock.
- Buy wall residual (I-02): a reference held pumped for ≥ 2 blocks can pull the floor toward it by one day's
  allowance per day.
- Partial fills of beforeSwap-taxed swaps revert. `SeaportAdapter` untested against Seaport.
- `block.number` on Robinhood Chain is the parent-chain block number (reference lag and sCOMD hold use it).
