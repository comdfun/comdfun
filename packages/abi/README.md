# @company/abi

Generated ABIs (`as const`, viem-ready) and the per-chain address book of Company.md's contracts.
TypeScript source, no build step. **Contracts are UNAUDITED.**

```ts
import { addresses, comdRouterAbi, counselNFTAbi, identityRegistryAbi, CHAIN_IDS } from "@company/abi";

const book = addresses[CHAIN_IDS.testnet]; // 46630
if (!book.deployed) throw new Error("not deployed yet"); // missing contracts are 0x000…000
await client.readContract({ address: book.counselNFT, abi: counselNFTAbi, functionName: "totalSupply" });
```

## Regenerate

```bash
cd contracts && forge build             # or FOUNDRY_PROFILE=local forge build
cd ../packages/abi && npm run gen        # node scripts/gen-abi.mjs
```

`gen` reads `contracts/out/<File>.sol/<Contract>.json` and `contracts/deployments/<chainId>.json` (written by
`script/Deploy.s.sol`). Chains 4663 and 46630 are always present; a chain without a deployment file gets
zero-address placeholders (`deployed: false`) plus the external defaults (PoolManager, WETH, Permit2).

## Exports

| Export | Source contract |
|---|---|
| `comdTokenAbi` | ComdToken (ERC-20 + `burn`, `burnFrom`, `permit`) |
| `comdTaxHookAbi` | ComdTaxHook — official pool: tax (`taxBps`, `totalTaxed`, `pendingTax`), capped inventory (`inventory`, `cap`, `currentCap`, `params`, `stats`, `claimEth`, `claimComd`, `refTick`), `flush`, `observe`, `poolKey`, `slot0`, `initializeAndSeed` |
| `buyWallAbi` | BuyWall (`rebalance`, `canRebalance`, `wallAmounts`, `wallLiquidity`, `floorTick`, `previewFloorTick`, `params`, `parkedEth`, `totalWallBought`) |
| `comdRouterAbi` | ComdRouter (`swapExactETHForComd`, `swapExactComdForETH`, `quoteETHForComd`, `quoteComdForETH`) |
| `flywheelAbi` | Flywheel (2 buckets: buyback / sweep) |
| `stakedComdAbi`, `rewardDripperAbi`, `bondAbi` | sCOMD vault, staker stream, bond (sells the reserve for ETH: `priceEth`, `quote`, `buyWithEth`) |
| `marketplaceAdapterAbi`, `seaportAdapterAbi`, `mockMarketplaceAbi` | floor-sweep adapters |
| `counselNFTAbi` | CounselNFT |
| `identityRegistryAbi`, `reputationRegistryAbi` | vendored CC0 ERC-8004 v2.0.0 (call at the proxy addresses) |
| `rewardDistributorAbi` | Counsel rewards (COMD from trims and job revenue; ETH via `address(0)` supported) |
| `revenueRouterAbi` | job payTo (COMD: 80% Counsel rewards / 20% treasury) |
| `incorporationsAbi` | company coins launchpad (priced in COMD) |
| `projectFactoryAbi`, `contributorDistributorAbi`, `launchGuardHookAbi`, `launchTokenAbi` | launches |
| `oracleConsumerExampleAbi`, `create2DeployerAbi` | helpers |
| `addresses`, `getAddresses(chainId)`, `ZERO_ADDRESS` | address book (keys: `comdToken`, `counselNFT`, `identityRegistry`, `reputationRegistry`, `comdTaxHook`, `comdRouter`, `buyWall`, `flywheel`, `stakedComd`, `rewardDripper`, `bond`, `rewardDistributor`, `revenueRouter`, `projectFactory`, `contributorDistributor`, `launchGuardHook`, `incorporations`, `mockMarketplace`, `seaportAdapter`, `create2Deployer`, `poolManager`, `weth`, `permit2`, `admin`, `pol`, `treasury`) |
| `oracleDomain(chainId)`, `oracleAttestationTypes`, `merkleLeafTypes` | EIP-712 ("Company.md Oracle") / Merkle encodings |
| `CHAIN_IDS`, `COMD_POOL`, `FLYWHEEL_DEFAULT_BPS`, `TRIM_SPLIT_BPS`, `CAP_DEFAULTS`, `REVENUE_DEFAULT_BPS`, `ETH_ASSET`, `LAUNCH_KINDS` | constants |

Changed in V3: Flywheel `bps()`/`bucketBalances()` return two values; `distribute`/`totalRewards`/`RewardsSent` removed;
new `buyWallAbi`, `stakedComdAbi`, `rewardDripperAbi`, `bondAbi`; address keys `buyWall`, `stakedComd`,
`rewardDripper`, `bond` added.

Changed in V4: USDG removed everywhere (no `mockUSDGAbi`, no `usdg` address key, no `USDG_DECIMALS`).
RevenueRouter takes COMD (`comd()`, `bps()` = rewards/treasury, default 80/20). Bond sells the reserve for ETH:
`priceEth()` (wei per 1e18 COMD), `quote(ethIn)`, `buyWithEth(minOut)` payable, proceeds to the treasury.

## ERC-8004 agent registration (exact signatures)

The vendored IdentityRegistry is overloaded. The one the API's `GET /agents/register-intent` must encode is:

```
register(string agentURI) returns (uint256 agentId)        selector 0xf2c298be
```

- `agentURI` = `${PUBLIC_API_URL}/agents/by-token/${tokenId}.json` (= `CounselNFT.tokenURI(tokenId)`).
- Mints an ERC-721 agent ("AgentIdentity"/"AGENT") to `msg.sender` with `_safeMint` (contract wallets must
  implement `onERC721Received`). **Agent ids start at 0** and are independent of Counsel token ids — bind them
  off-chain (`POST /agents/bind`). Sets metadata `agentWallet = msg.sender`.
- Other overloads: `register()` (0x1aa3a008, no URI) and
  `register(string agentURI, (string metadataKey, bytes metadataValue)[] metadata)` (0x8ea42286; key
  `"agentWallet"` is reserved). With viem, pick the overload by passing `args: [agentURI]`.
- Event: `Registered(uint256 indexed agentId, string agentURI, address indexed owner)`.

Reputation (accepted work, from the platform's wallet — never the agent owner/operator, which reverts
`"Self-feedback not allowed"`):

```
giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2,
             string endpoint, string feedbackURI, bytes32 feedbackHash)      selector 0x3c036a7e
```

`|value| ≤ 1e38`, `valueDecimals ≤ 18`. Read back with `readFeedback(agentId, client, index)` (1-based index),
`getLastIndex(agentId, client)`, `getSummary(agentId, clients[], tag1, tag2)` (clients required).

## Other encodings

- Counsel allowlist leaf: `keccak256(bytes.concat(keccak256(abi.encode(address account))))`.
- Seat reward leaf (one root per `(epoch, asset)`): `keccak256(bytes.concat(keccak256(abi.encode(uint256 epoch, uint256 tokenId, uint256 amount))))`.
  COMD: `claim(epoch, tokenId, amount, proof)`; any asset incl. ETH (`address(0)`): `claimToken(asset, epoch, tokenId, amount, proof)`.
  Settler posts with `postRoot(epoch, asset, root, total)`.
- Contributor leaf (one root per launch): `keccak256(bytes.concat(keccak256(abi.encode(uint256 launchId, address account, uint256 amount))))`.
  OpenZeppelin `StandardMerkleTree.of(values, ["uint256","address","uint256"])` produces exactly this.
- Oracle attestations: `oracleDomain(chainId)` + `oracleAttestationTypes` with viem `signTypedData`
  (domain has no `verifyingContract`; `chainId` = chain where it is verified).
- `ComdRouter.quoteETHForComd` / `quoteComdForETH` are non-view (call with `simulateContract`/`eth_call`) and net of the 5% tax.
