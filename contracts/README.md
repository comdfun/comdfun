# Company.md — contracts

> ## Reviewed before launch
> Every contract went through an internal security review (`SECURITY_REVIEW.md`, `AUDIT.md`: every finding and
> its fix, with a test) and an independent security review. Owner and keeper keys hold real powers (listed below)
> and every money-holding contract has pause and recovery (`AUDIT.md` §3). Deploy to testnet (46630) first.
> Not affiliated with Robinhood or Pons.

Solidity 0.8.26, OpenZeppelin 5.4, Uniswap v4-core, Foundry. License MIT (vendored ERC-8004 registries: CC0;
v4-core `PoolManager`: BUSL-1.1 — only deployed by us in tests and on testnet when no `POOL_MANAGER` is given).

## How value moves

```
  $COMD launched on Pons (1B supply, ETH pair, 5% tax set in Pons; Pons runs the curve and locks the v4 liquidity)
  Pons pays the creator wallet in ETH (tax + fee share) ─► forwarded to the Flywheel (`receive()`)
       Flywheel: 50% buyback (ETH→COMD via the swapper, COMD → 0x…dEaD) / 50% Counsel NFT floor sweep
  job payments (x402 + Permit2, COMD) ─► RevenueRouter: 80% RewardDistributor (Counsel, COMD) / 20% firm treasury
  Incorporations (company coins on a COMD curve): 1% → RewardDistributor, 0.5% → 0x…dEaD, 0.5% → launcher
```

## Pons mode

- **COMD comes from Pons.** The token is minted by Pons at launch (`COMD_TOKEN` env on mainnet); this repo never
  deploys a production token. It is treated as a plain ERC-20: decimals are read on-chain and no `burn()` is assumed.
  Every "burn" is a transfer to `0x000000000000000000000000000000000000dEaD`, counted in `totalBurned`
  (Flywheel) / `totalBurned` (Incorporations). Test chains deploy `MockComd` (1B, 18 dec, no `burn()`).
- **The Flywheel receives ETH.** `receive()` and `notifyTax()` accept ETH from anyone (set the Flywheel as Pons's
  payout recipient or forward from the creator wallet). Each wei is split into the buyback / sweep buckets by `bps()`.
- **Swapper configured after graduation.** Buybacks and Incorporations' ETH legs go through a pluggable
  `IBuybackSwapper`. `UniswapV4PoolSwapper` is deployed unconfigured; once Pons has graduated $COMD into its v4
  position, `ADMIN` calls `setPoolKey(fee, tickSpacing, ponsHook)`. Until then `Flywheel.buyback` reverts
  (`PoolNotSet()` from the swapper; `SwapperNotSet()` if no swapper is set at all) and ETH simply accumulates; COMD
  trades on Incorporations work from day one, ETH trades revert `SwapperNotSet()` / `PoolNotSet()`.
  If Pons's hook rejects swaps from an arbitrary unlock caller or needs special hookData, plug in another
  `IBuybackSwapper` (e.g. over Pons's / Uniswap's router) with `setSwapper` on the Flywheel and Incorporations.
  The swapper is tested against a local hookless v4 pool only; Pons's hook is not reproduced in tests.

## Contracts

| Contract | File | What it does |
|---|---|---|
| $COMD (external) | Pons | 1,000,000,000 supply, 18 dec, minted by Pons; `COMD_TOKEN` env. `src/mocks/MockComd.sol` stands in on test chains (plain ERC-20, no `burn()`). |
| `Flywheel` | `src/Flywheel.sol` | `receive()`/`notifyTax()` from anyone → buckets buyback / sweep (default 50/50). Keeper `buyback(minOut)` via `IBuybackSwapper` → COMD to `0x…dEaD`; keeper `sweep(...)` (Counsel NFTs via allowlisted adapters, ≤ `maxSweepPrice`); owner `awardSwept`, `setSwapper`, `setComd` (once). |
| `IBuybackSwapper` / `UniswapV4PoolSwapper` | `src/interfaces/`, `src/swap/` | Pluggable ETH↔COMD venue. The v4 implementation swaps through `IPoolManager.unlock` on an owner-set PoolKey (currency0 ETH, currency1 COMD, `setPoolKey(fee, tickSpacing, hooks)` = Pons's pool after graduation). Non-view quoters. Holds nothing. |
| `RevenueRouter` | `src/RevenueRouter.sol` | payTo of job payments (COMD): `distribute()` (anyone) 80% RewardDistributor / 20% treasury. |
| `RewardDistributor` | `src/RewardDistributor.sol` | Counsel rewards: one Merkle root per (epoch, asset) — COMD (80% of job revenue + 1% Incorporations fee); ETH (`address(0)`) also supported; claims pay the current seat owner; a root never pays more than its total. |
| `CounselNFT` | `src/CounselNFT.sol` | "Company.md Counsel" (COUNSEL), 2,000 seats. |
| ERC-8004 registries | `lib/erc-8004-contracts` (CC0) | Behind ERC1967 proxies via `ERC8004Bootstrap`. |
| `Incorporations` | `src/Incorporations.sol` | Company coins on a COMD curve; fees 1% → RewardDistributor (Counsel), 0.5% → `0x…dEaD`, 0.5% launcher; ETH legs through the swapper (`SwapperNotSet()` until set). |
| `ProjectFactory` & launch contracts | `src/launch/` | Swarm launches; pairing allowlist ETH, COMD. |
| `IMarketplaceAdapter`, `MockMarketplace`, `SeaportAdapter` | | Floor-sweep adapters (mock = test chains; Seaport = untested skeleton needing marketplace calldata). |
| `OracleAttestationVerifier` | `src/oracle/` | EIP-712 "Company.md Oracle". |

## Owner / keeper powers

| Contract | Holder | Powers | Cannot | Renounce |
|---|---|---|---|---|
| `Flywheel` | Ownable2Step / keeper | owner: bucket bps (sum 10,000), `maxSweepPrice`, adapters, keeper, `awardSwept`, `setSwapper` (any time — a malicious swapper can take the buyback bucket, so keep ADMIN behind a multisig), `setComd` once; keeper (or owner): `buyback(minOut)` slippage, `sweep` listing choice within caps | withdraw bucket ETH | yes |
| `UniswapV4PoolSwapper` | Ownable2Step | `setPoolKey(fee, tickSpacing, hooks)` (re-pointable) | hold funds (holds nothing between calls) | yes |
| `RevenueRouter` | Ownable2Step | `setBps(rewardsBps)` 5,000–10,000; `setTreasury` | send COMD revenue elsewhere | yes |
| `RewardDistributor` | admin / SETTLER | roots within the unallocated balance; expire after 365 d | over-pay a root | yes |
| `Incorporations` | Ownable2Step | `setVirtualComd` within bounds (new coins only); `setSwapper` (same caveat as the Flywheel: ETH legs trust the venue) | touch coin backing | yes |
| others | — | as before (CounselNFT, ProjectFactory, ERC-8004 upgrades) | | |

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
export COMD_TOKEN=0x...                                      # the Pons $COMD address (required on mainnet)
export ADMIN=0x... TREASURY=0x... SETTLER=0x... KEEPER=0x... REGISTRAR=0x...
# test chains: COMD_TOKEN optional (MockComd is deployed if unset); POOL_MANAGER optional (a v4 PoolManager is
# deployed if unset); mainnet PoolManager default 0x8366…40951
# optional: MAX_SWEEP_PRICE, SEAPORT, COUNSEL_BASE_URI
forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --broadcast --slow
(cd ../packages/abi && npm run gen)
```

`deployments/<chainId>.json` keys: `chainId, deployedAtBlock, comdToken` (external), `counselNFT, identityRegistry,
reputationRegistry, rewardDistributor, revenueRouter, flywheel, swapper, incorporations, projectFactory,
contributorDistributor, launchGuardHook, create2Deployer, mockMarketplace` (test chains), `seaportAdapter` (if
`SEAPORT`), `admin, treasury, keeper, settler, registrar, poolManager, weth, permit2`.

Then:
1. `ADMIN` calls `acceptOwnership()` on `Flywheel` (the deployer did its one-time wiring first). `Incorporations`,
   `UniswapV4PoolSwapper`, `RevenueRouter`, `CounselNFT` are owned by `ADMIN` directly.
2. Point Pons's ETH payouts at the `flywheel` address (or forward them from the creator wallet).
3. After the Pons graduation: `ADMIN` calls `UniswapV4PoolSwapper.setPoolKey(fee, tickSpacing, ponsHook)` with the
   graduated pool's parameters (currency0 = ETH, currency1 = COMD). Verify with `quoteETHForComd` (eth_call) before
   the first keeper buyback.
4. API env: `PAYTO_ADDRESS=revenueRouter`, `COMD_TOKEN`, `FLYWHEEL`, `SWAPPER`.
5. Keepers: `Flywheel.buyback(minOut)` when the swapper is configured and the bucket is above the threshold,
   `Flywheel.sweep(...)`, `RevenueRouter.distribute()`.

### Deploy from CI (GitHub Actions, env only)

The script reads everything from the environment (no prompts, no input files) and prints machine-readable JSON to
stdout between markers, so a workflow can capture it without reading files:

| Script | Required env | Optional env | Stdout markers |
|---|---|---|---|
| `Deploy.s.sol:Deploy` | `RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `COMD_TOKEN` (the Pons token; required on 4663 and any chain other than 46630/31337 — the script reverts with a clear message if unset) (+ `POOL_MANAGER` on chains other than 4663/46630/31337) | `ADMIN` (default deployer), `TREASURY`, `SETTLER`, `KEEPER`, `REGISTRAR` (default ADMIN), `MAX_SWEEP_PRICE` (0.5 ether), `SEAPORT`, `COUNSEL_BASE_URI`, `WRITE_DEPLOYMENTS` (true; creates `deployments/` if missing) | `DEPLOYMENTS_JSON_BEGIN` / `DEPLOYMENTS_JSON_END` |

For production, set every role explicitly (`ADMIN`, `TREASURY`, `KEEPER`, `SETTLER`, `REGISTRAR`) as repository
secrets/variables; leaving them unset makes the deployer hold the role.

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
    COMD_TOKEN: ${{ vars.COMD_TOKEN }}
    ADMIN: ${{ vars.ADMIN }}
    TREASURY: ${{ vars.TREASURY }}
    KEEPER: ${{ vars.KEEPER }}
    SETTLER: ${{ vars.SETTLER }}
    REGISTRAR: ${{ vars.REGISTRAR }}
  run: |
    forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" --broadcast --slow | tee deploy.log
    sed -n '/DEPLOYMENTS_JSON_BEGIN/,/DEPLOYMENTS_JSON_END/p' deploy.log | sed '1d;$d' | sed 's/^ *//' > deployment.json
    echo "FLYWHEEL=$(jq -r .flywheel deployment.json)" >> "$GITHUB_ENV"
    echo "SWAPPER=$(jq -r .swapper deployment.json)" >> "$GITHUB_ENV"
```

`ADMIN` still has to call `acceptOwnership()` on the Flywheel, and `setPoolKey(...)` on the swapper after the Pons
graduation.

### External address checklist (mainnet)

- [ ] `eth_chainId` = `0x1237` (4663).
- [ ] v4 PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951`: verified Uniswap v4 source.
- [ ] `COMD_TOKEN` = the $COMD address Pons minted (check `decimals()` = 18, `totalSupply()` = 1e27).
- [ ] Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3` (x402 settlement, off-chain). WETH / UniversalRouter not used.
- [ ] LaunchGuardHook address low bits `0x2000`.
- [ ] After graduation: Pons pool `fee`, `tickSpacing`, hook address for `setPoolKey`; `quoteETHForComd` returns a sane amount.
- [ ] `ADMIN` multisig (+ timelock); SETTLER / KEEPER / REGISTRAR separate wallets.

## Known limitations

- **Review status.** Internal review plus an independent review before launch; see `AUDIT.md` and `SECURITY_REVIEW.md`.
- The token, the tax and the pool belong to Pons: we cannot change the tax, the liquidity or the hook. The
  Flywheel only ever sees the ETH that is actually forwarded to it.
- `UniswapV4PoolSwapper` is tested against a hookless local v4 pool only. Pons's hook may tax inside the swap
  (fine: amounts are measured on delivery) or refuse arbitrary unlock callers / require hookData (then another
  `IBuybackSwapper` has to be plugged in). Buybacks through it are keeper-paced, exact-input, with `minOut`.
- Keeper trust (buyback slippage, sweep choice); owner trust (`setSwapper` on Flywheel / Incorporations can route the
  buyback bucket or an ETH trade's COMD leg to any venue). Put `ADMIN` behind a multisig + timelock.
- `SeaportAdapter` untested against Seaport.
