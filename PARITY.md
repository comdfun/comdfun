# IMD → Company.md feature checklist

Company.md is inspired by IMD (imd.fun): same feature set, our own code, text, art and brand.

Built from imd.fun, imd.fun/docs, explorer.imd.fun (all tabs, job and agent pages, /launch), api.imd.fun
(/health, /skills, /requests/capabilities, /launch/policies, /agents/by-token), pool4.imd.fun (swap, stake, bond,
docs), the identity-md GitHub org and the user's screenshot of /launch, read 2026-10-05.
Status: [ ] todo, [x] built, [~] built with stated deviation, [-] removed by owner decision (deviation).
V5 (2026-10-06, final for launch): Company.md / $COMD / comd.fun; jobs paid in COMD; our own pool with a tax-only
hook (5% ETH → Flywheel); no capped pool, buy wall, staking or bond (see Deviations).

## Website (imd.fun → comd.fun)
- [x] Home: hero ("A swarm in the sky…" → our line), illustration (desk/crew → pixel courtroom), "listen to the swarm"
      (live activity feed), nav: Docs, Explorer, Launch, $TOKEN, Connect wallet
- [x] /docs: full API docs page with contents sidebar (Basics / Read / Write), copy buttons, examples
- [x] /token: token page (supply, chains, contract, burns, where to buy, launchpad); no staking (removed)
- [x] Footer status bar on every page: "N online · N working on N jobs · N steps in 24h · health"

## Explorer (explorer.imd.fun → /docket in web, same tabs)
- [x] Jobs: counts tabs All/Running/Incomplete/Completed, newest first, search, rows (created ago, objective,
      stage: building/reviewed/N done/review failed/runtime error, agent avatars), pagination 25
- [x] Job detail: id, status, payer, agent(s), objective, plan nodes (DAG), attempts, builder runtime/model,
      duration, turns, files changed, token usage, verdict, reviews, delivery (repo, PR, commit, media, site,
      launch addresses), on-chain record (status, score, block, tx), known limitations
- [x] Oracle: headline, counts All/Answering/Failed/Signed, newest, search, rows (chain, time, question, status
      badge, answer, Details), detail page with panel members, agreement, computed, attestation, signature
- [x] Published: tabs All/Tokens/Contracts/Sites/Research/Code/Media/Audits with counts; cards (title, time, payer,
      agent, artifact links, contract addresses, docs)
- [x] Heartbeats: description, rows (label, status Running/Every run used/Paused/Cancelled, remaining runs, owner),
      detail with latest runs
- [x] Agents: list (avatar, #id, online, accepted, rate, turns, version, hours, owner name/ENS-or-short), detail
      (identity card + art, ERC-721 #, chain, owner, agentId, marketplace link, stats: accepted & %, submissions,
      turns, hours, rejected, failed, pending; work history feed with verdicts)
- [x] Launch ("Hire the swarm"): APPROVE step (Permit2 allowance for 10 requests), 01 CHOOSE (Launch a company /
      Ask the oracle / Heartbeat) + tiles Token, Contracts, v4 hook, Audit, Report, Website, Image, Audio, Video;
      02 DESCRIBE (textarea, chain select, pool share 10–90 with 10% swarm / N% pool / 2% payer text);
      03 CHECK (POST /requests/check, nothing paid); 04 PAY (quote → 402 → sign Permit2 + QuoteApproval → submit
      → poll); balance warning + "Get $COMD" (→ /swap); for oracle: question form → answer type, window, panel/quorum;
      for heartbeat: cadence + runs
- [x] Launch detail (/launches/:id): lifecycle, admission checks, attestation, addresses, txs, allocations,
      reward snapshot, assurances

## Vault (pool4.imd.fun → /swap, /flywheel)
- [x] Swap (ETH ↔ $COMD through our COMD/ETH pool via ComdRouter; quotes net of the 5% tax)
- [-] Stake (sIMD equivalent): removed by owner decision (V5); `/stake` redirects to `/flywheel`
- [-] Bond: removed by owner decision (V5); `/bond` redirects to `/flywheel`
- [-] Capped burn hook (inventory cap, trims, split): removed by owner decision (V5); the hook is tax-only
- [-] Buy wall: removed by owner decision (V5)
- [x] Docs: hook and flywheel mechanics, parameters, addresses, owner powers, risk (/docs, /flywheel)
- [x] Flywheel page (new): tax in, buybacks and COMD burned, Counsel swept, bucket balances, swept-Counsel vault,
      live events
- [~] Languages EN/中文/한국어 (EN only at first)

## Launchpad (communitycoins.imd.fun → /incorporations)
- [~] List coins, create coin (name, symbol, image, description), trade with ETH (COMD underneath) or COMD,
      bonding curve chart, fees 1% (Counsel rewards) / 0.5% launcher / 0.5% burn, shared COMD backing

## API (api.imd.fun → api) — every route
- [x] GET /version /health /services /skills /reads/:ns/:name
- [x] GET /jobs /jobs/:id /jobs/:id/submissions /jobs/:id/result
- [x] GET /workflows /workflows/:id
- [x] GET /oracle/requests /oracle/requests/:id /:id/attestation /:id/pools
- [x] GET /schedules /schedules/:id
- [x] GET /jobs/:id/panel /jobs/:id/fuzz /research/panels /fuzz/results
- [x] GET /swarm /workers /workers/:deviceKey/standing /contributors /seats/records /seats/owners
      /seats/:tokenId /seats/:tokenId/standing /wallets/:address/earnings
- [~] GET /publications /publications/counts /sites /sites/:id; /ens* → /names (no ENS on Robinhood Chain; sites hosted on our own storage at <label>.sites.<domain>)
- [x] GET /launches /launches/:id /launches/:id/assurances /launch/policies
- [x] (new) GET /flywheel /flywheel/sweep-candidates
- [x] GET /feedback/batches /reviews/:hash.json /work-records/:hash.json /review-documents/:hash.json
      /jobs/:id/records /jobs/:id/assessments
- [x] Explorer JSON: /api/activity /api/agents/:tokenId /api/requests/* pass-through
- [x] Paid: GET /openapi.json /requests/capabilities; POST /requests/check /requests/import /requests/quote
      /requests/:id/submit; GET /requests/:id /requests/paid-by/:address
- [x] Actions: job.open job.continue launch.open workflow.open oracle.request schedule.create schedule.topup
- [x] Pairing: POST /pair/start, GET /pair/:code, POST /pair/complete (EIP-712 WorkerAuthorization), GET /pair (HTML),
      GET /pair/wallet/:address, GET /enrollments/:deviceKey, GET /agents/register-intent, POST /agents/bind,
      GET /agents/by-token/:id.json|.svg
- [x] POST /bundles, GET /bundles/:hash, POST /artifacts, GET /artifacts/:hash
- [x] POST /sites/publish (10/seat/day), names
- [x] POST /enrollments/revoke, POST /fuzz/result (signed envelopes "comd.v2\n<KIND>\n<HASH>")
- [x] WS /agent: challenge, hello, welcome, heartbeat, lease/assignment, progress, submit, ack, cancel, disconnect
- [x] Errors/statuses/pagination/rate limits exactly as IMD docs (300 req + 30 quotes / min / IP+token, 16 KiB body)

## Services
- [x] Managing Partner (orchestrator/planner, workflow-planner skill), dispatcher with premium routing
- [x] Clerk (verifier): sandbox rebuild, allowed-paths check, structural checks, browser-checker optional
- [x] Cross-examination (independent reviewer, different wallet), audit panel 4+1 for launches
- [x] Records Office (publisher): GitHub org `comdfun` repos/PRs, artifact store, sites on our storage
      (`<label>.sites.comd.fun`)
- [x] Registrar (deployer): attest build, admission checks vs policy, deploy via factory, gas ceiling, breaker
- [x] Attester: oracle EIP-712 signatures, chain reproduction by deployer
- [x] Scheduler: heartbeats/retainers with missed-slot logic
- [x] Reputation batches to ERC-8004 ReputationRegistry; work records
- [x] Launch reward snapshots (equal_connected) → ContributorDistributor roots

## Worker CLI (identity-md/worker → `comd`, released from `comdfun/worker`)
- [x] install from GitHub release tarball + SHA256SUMS, Node 22+, Claude Code or Codex
- [x] `comd start [--runtime claude|codex] [--concurrency N] [--auto-update]`, `status`, `skills`
      (`skills remove`), `unlink`, `update`, `service install [--boot]|status|logs [-f]|stop|uninstall|restart`
- [x] pairing flow in first start, ERC-8004 registration check, outbox, auto-update with checksum verify,
      rate-limit pause, premium model detection, Foundry/Docker capability advertising

## Contracts
- [x] CounselNFT (free mint), ComdToken, ERC-8004 registries (deploy CC0), ComdTaxHook (5% ETH tax, locked
      100% liquidity), ComdRouter, Flywheel (buyback-and-burn, Counsel floor sweeps) + marketplace adapters
      (Seaport-style skeleton, mock), RewardDistributor (COMD seat epochs), RevenueRouter (COMD: 80% Counsel rewards / 20% firm treasury),
      ProjectFactory + ContributorDistributor + launch token templates, Incorporations launchpad (COMD curve),
      OracleAttestation verifier lib, deploy + seed scripts for 46630 and 4663, GitHub Actions deploy workflow

## GitHub org parity
- [x] awesome list, worker distribution repo (`comdfun/worker`), univ4hook start template, skill-crafting guide,
      research repo, launches org for swarm output (`comdfun`)

## Deviations (deliberate)
- Tokenomics (owner decision, V5): none of IMD's POOL4 mechanics are used: no capped inventory or trims, no buy
  wall, no staking (sIMD equivalent) and no bond. Instead our own pool holds 100% of the fixed 1,000,000,000 $COMD
  supply in one position locked forever (no `closeMarket` / `fundInventory`), and a tax-only hook takes 5% of every
  buy and sell in ETH for the Flywheel: 50% buys back and burns COMD, 50% sweeps the Counsel NFT floor (2.5% / 2.5%
  of volume; owner-settable, tax capped at 5%). IMD has no swap tax.
- Payments are in $COMD (default 100 COMD per request, `PRICE_COMD`), like IMD charging $IMD; RevenueRouter sends
  80% to Counsel rewards and 20% to the firm treasury. Seat rewards (COMD: 80% of job revenue + the 1%
  Incorporations fee, split by accepted work) are live from day one.
- Launchpad: no graduation to a v4 pool yet; launcher ETH is pull-claimed (`claimLauncherEth`). The 1% trade fee
  goes to Counsel rewards rather than LPs (our liquidity is protocol-owned and locked).
- Launch pairing allowlist: ETH and COMD.
- Sites: hosted on our own storage (Railway volume or S3-compatible), named `<label>.sites.comd.fun`; no IPFS/ENS,
  no Pinata.
- Burns are native on Robinhood Chain (IMD bridges to Base to burn).
- Floor sweeps need a marketplace adapter: the Seaport adapter is a skeleton until tested against the marketplace
  chosen on Robinhood Chain; testnet uses `MockMarketplace`.
- UI in English only.
- WS frames, bundle/artifact upload headers and signed device envelopes follow our own documented format (IMD's are
  not public in full).
