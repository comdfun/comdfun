# @company/services

Back-office modules for the Company.md control plane (Chambers). Pure TypeScript ESM functions, no framework,
no database: the `api` app and the `services` process call them.

| Module | Office | Exports |
|---|---|---|
| `blobstore.ts` | storage | `createBlobStore` |
| `verifier.ts` | the Clerk | `verifySubmission`, `validateWorkflowPlan`, `extractCitations` |
| `github.ts` | Records Office | `publishRepo` |
| `sites.ts` | Records Office | `publishSite`, `serveSite`, `siteContentCheck` |
| `deployer.ts` | Registrar | `deployLaunch`, `validateLaunchManifest`, `parseBroadcast` |
| `skills.ts` | catalog | `loadSkillCatalog`, `getSkill`, `readSkillMarkdown`, `CHECK_IDS` |

Attestation signing is not here (the api signs attestations).

Runs on Node 22.18+ directly from `src/` (type stripping; only erasable TypeScript syntax is used, and
relative imports carry `.ts`). `npm run build` emits `dist/` for runtimes that prefer JS.

```bash
npm test -w @company/services        # node:test via tsx
npm run typecheck -w @company/services
```

---------------------------------------------------------------------------------------------------------------

## Blob store

```ts
import { createBlobStore } from "@company/services";
const store = createBlobStore(process.env);

const { hash, url, created } = await store.put(bytes, { mediaType: "image/png" }); // key blobs/<hh>/<sha256>
await store.has(hash);                 // boolean
await store.get(hash);                 // { data, mediaType, hash } | null; throws if bytes do not match the hash
store.url(hash);                       // public URL

await store.putObject("sites/docket/<v>/files/index.html", html, { mediaType: "text/html", cacheControl: "..." });
await store.getObject(key); await store.hasObject(key); store.objectUrl(key);
```

`put` is content-addressed and idempotent (`created: false` when the blob already existed). Named objects
(`putObject`) overwrite. Keys may not be absolute, contain `..`, empty segments, or start with `.meta/`.

| Env | Driver | Meaning |
|---|---|---|
| `STORAGE_DRIVER` | both | `local` or `s3` (default: `s3` when `S3_BUCKET` is set, else `local`) |
| `STORAGE_DIR` | local | directory (default `./storage`); media types in `.meta/<key>.json` sidecars; writes are atomic (tmp + rename) |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | s3 | required |
| `S3_REGION` | s3 | default `us-east-1` (R2 accepts `auto`) |
| `S3_PUBLIC_URL` | s3 | public base for object URLs, e.g. `https://pub-xxxx.r2.dev` |
| `S3_VIRTUAL_HOSTED=true` | s3 | bucket-subdomain addressing (default path-style) |
| `S3_SESSION_TOKEN` | s3 | optional temporary credentials |
| `BLOB_PUBLIC_URL` | both | `url(hash)` = `${BLOB_PUBLIC_URL}/${hash}` (e.g. `https://api.comd.fun/artifacts`) |
| `PUBLIC_API_URL` | local | fallback `url(hash)` = `${PUBLIC_API_URL}/blobs/${hash}` |

The S3 driver signs requests with a built-in SigV4 implementation (`sigv4.ts`) over `fetch`: no AWS SDK.
It retries 5xx and network errors three times with backoff. No Pinata/IPFS.

---------------------------------------------------------------------------------------------------------------

## The Clerk: `verifySubmission`

```ts
const result = await verifySubmission({
  workspaceDir,                 // the seat's submitted tree
  baseDir,                      // tree it started from (omit: every file counts as added)
  allowedPaths: ["src/", "test/**/*.t.sol"],   // step `paths`; prefixes, exact files or globs
  skill: "write-foundry-tests", // id (looked up in skills/index.json) or a SkillMeta object
  outputs: [{ name: "report", path: "artifacts/report.md", mediaType: "text/markdown" }],
  timeoutMs: 600_000,           // whole budget; each command gets what is left
  minCitations: 3, rubricContains: ["..."],   // research
  forgeBin, npmBin, minTests, cpuSeconds, skillsDir,
});
// => { ok, skill, checks: [{ id, status: "pass"|"fail"|"skip"|"error", detail }], findings: [{ check, severity, message, path? }],
//      changed: { added, modified, deleted }, durationMs }
```

`ok` is true only when every check passed or was skipped. A missing toolchain (no forge) is `error`, never a pass.

What runs: the skill's `checks` (from its SKILL.md frontmatter), plus symlink refusal, plus the write-budget and
outputs checks even if a skill forgot them. Check ids (`CHECK_IDS`, identical to `skills/check-skill.mjs`):

| Check | Behaviour |
|---|---|
| `paths` | sha256 diff of workspace vs base (ignoring `.git`, `node_modules`, `out`, `cache`, `dist`, `broadcast`, `.company` reads); every add/modify/delete must match `allowedPaths` or `artifacts/` or a declared output. A `writes: paths` skill with no paths fails. |
| `no-writes` | only `artifacts/` may change |
| `outputs` | declared outputs (job + skill) exist, are non-empty, live under `artifacts/`, and their magic bytes match the declared media type |
| `foundry-build` | `forge build [--offline]` in a temp copy (plain build: `forge build --json` exits 0 on compile errors) |
| `foundry-test` | `forge test`; parses the summary; at least `minTests` (default 1) passing; failing test names become findings |
| `foundry-sizes` | `forge build --sizes --json`; runtime ≤ 24,576 B and initcode ≤ 49,152 B (Test/Script/Mock/Harness excluded) |
| `foundry-script` | `script/*.s.sol` exists, no 32-byte hex literal (keys come from env) |
| `project-build` | Foundry build+test and/or npm build, whichever the project has |
| `web-build` | `npm ci` (or `npm install` when no lockfile, with a warning), `npm run build`, `dist/index.html` must exist |
| `site-screen` | `siteContentCheck` over the built `dist/` (block → fail) |
| `npm-check` | `npm ci`, `npm run --if-present typecheck`, `npm run --if-present test` |
| `indexer` | Ponder layout and dependency |
| `research-citations` | markdown report with ≥ `minCitations` distinct URLs (fragments ignored), ≥ 400 chars, every rubric phrase |
| `media-image` / `media-audio` / `media-video` | real media by magic bytes (PNG, JPEG, GIF, WebP, AVIF, BMP; MP3, WAV, OGG, FLAC, M4A, AAC; MP4, MOV, WebM, AVI) |
| `review-report` | `artifacts/review.json`: verdict accept/reject consistent with blocking findings, severities, evidence, existing locations; `area` for specialists, `reproduced` for the judge |
| `site-verdict` | `artifacts/site-verdict.json`; a `pass` may not contradict the Clerk's own screen of the site under review |
| `workflow-plan` | `artifacts/workflow.json`: shape, 1–6 runnable steps, DAG keys/dependsOn, single sink |
| `oracle-answer` | `artifacts/answer.json` typed to `answerType`, ordered blocks, non-empty recipe (or refused/ambiguous with reason) |
| `findings-response` | `artifacts/responses.json` answers every blocking finding in `.company/reads/findings.json` |
| `gas-report` | `artifacts/gas-report.json` schema and deployability vs size limits |
| `readme` | `README.md` with install/usage/development headings, a code block, ≥ 600 chars |
| `launch-manifest` | `launch.json` valid (`validateLaunchManifest`) and its script exists |

Sandbox (`sandbox.ts`): commands run in a temp copy of the workspace (without `.git`/`node_modules`) with a
stripped environment (PATH, HOME, locale, TMPDIR, CI; proxies only when the skill requires network), a
wall-clock timeout that kills the process group, and optional `ulimit -t` CPU seconds. Without the `network`
requirement, commands run in a fresh network namespace (`unshare -rn`) when the kernel allows unprivileged user
namespaces; otherwise proxies point at a dead port and npm is put offline (`network: "env-blocked"`, best
effort). Force the fallback with `SANDBOX_NET=env`.

---------------------------------------------------------------------------------------------------------------

## Records Office: `publishRepo`

```ts
const r = await publishRepo({ jobId, title, dir, org?, token?, baseRepo?, branch?, description?, private?, store? });
// => { dryRun, repoUrl, fullName, branch, commit, pullRequestUrl?, created?, tarball? }
```

- Org from `org` or `GITHUB_ORG` (default `comdfun`); token from `token` or `GITHUB_TOKEN`.
- New matter: repo `<slug(title)>-<jobId[0..8]>` is created with `POST /orgs/{org}/repos` if missing; the tree
  is committed (author "Company.md Records Office" <team@comd.fun>) and pushed to `main`.
- Continuation (`baseRepo: "owner/name"` or URL): the default branch is fetched, the tree replaces its contents
  on `job/<jobId>`, pushed (forced, job branches only), and a pull request is opened (an existing open PR for
  the branch is reused).
- git runs with a one-shot `http.extraHeader` Authorization header; the token is never written to `.git/config`
  and is scrubbed from error messages. `.git`, `node_modules`, `out`, `cache`, `broadcast`, `.env` are never filed.
- **Dry run** (no token): deterministic `repoUrl`, `commit` (sha256 of jobId + tree, 40 hex) and, for
  continuations, `pullRequestUrl` `…/pull/dry-run-<12 hex>`; a deterministic `.tar.gz` of the tree is put in the
  blob store and returned as `tarball`.
- `apiBaseUrl` / `gitBaseUrl` options exist for GitHub Enterprise and tests.

## Records Office: sites

```ts
const screen = await siteContentCheck(distDir, { maxTotalBytes?, maxFileBytes?, maxFiles?, scriptHosts?, styleHosts? });
// => { verdict: "pass" | "review" | "block", findings: [{ rule, severity, file?, line?, detail }], stats }

const pub = await publishSite({ label, distDir, store, sitesDomain?, screen?, activate? });
// => { label, version, url: "https://<label>.<SITES_DOMAIN>", manifestHash, manifestUrl, files, bytes, screen }

const res = await serveSite(store, label, req.url, { ifNoneMatch, method, version?, pointerTtlMs? });
// => { status, headers, body }
```

Layout in the store:

```
sites/<label>/current.json                     { label, version, manifestHash, publishedAt, previous }
sites/<label>/<version>/manifest.json          { schema: "company.site.v1", label, version, files: [{ path, sha256, mediaType, bytes }] }
sites/<label>/<version>/files/<path>           the static export
blobs/<hh>/<manifestHash>                      the manifest, content-addressed
```

`version` is the first 16 hex of the sha256 of the file table, so republishing identical bytes is idempotent.
`publishSite` runs the screen first and throws `SitePolicyError` on `block` (pass `screen: false` to skip when
the caller already screened). Labels match `^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$`.

`serveSite` (for the api's Host-header server on `*.sites.comd.fun`): `/` and `dir/` → `index.html`; `/about`
→ `about`, `about/index.html` or `about.html`; extensionless unknown paths → `index.html` (SPA fallback);
missing assets → `404.html` with status 404 if present; `GET`/`HEAD` only; `ETag` = file sha256 with 304 on
`If-None-Match`; `cache-control`: HTML `max-age=0, must-revalidate`, hashed assets (`name-<hash>.ext`)
`max-age=31536000, immutable`, others `max-age=300`; `x-content-type-options: nosniff`. The pointer is cached
15 s per label, manifests are cached by version. Each file's hash is re-checked on read.

Screen rules: missing `index.html`, file/site/count limits, symlinks, executables (block), server-side or
secret-looking files (warn), scripts or module preloads from hosts outside `DEFAULT_SCRIPT_HOSTS` (block),
stylesheets outside `DEFAULT_STYLE_HOSTS` (warn), iframes and meta-refresh redirects (warn), and content
patterns: named drainer kits, raw `eth_sign`, `setApprovalForAll` or unlimited `approve` to hard-coded
addresses, seed-phrase/private-key inputs, obfuscated `eval`, crypto miners, Telegram bot exfiltration (block);
Discord webhooks, keystroke capture near `fetch`, third-party brand in `<title>` (warn).

---------------------------------------------------------------------------------------------------------------

## Registrar: `deployLaunch`

```ts
const r = await deployLaunch({ policy, projectDir, chainId, rpcUrl?, privateKey?, factoryAddress?, dryRun?, forgeBin?, gasPriceWei?, timeoutMs?, scriptEnv? });
// => { mode: "plan" | "dry-run" | "broadcast", kind, chainId, policyVersion, script, addresses, transactions,
//      gasUsed, costWei, gasCeilingWei, withinCeiling, command, notes }
```

- Reads `launch.json` (schema `company.launch.v1`; see `skills/evm-project-launch`) and validates it against the
  policy (`validateLaunchManifest`): kind, chain, fee tier, paired currency, `poolBps` 1000–9000 and the policy
  floor, `evm_contracts` 1–8 contracts with only `$owner` / `$contract:Name` placeholders, decimal
  `gasCeilingWei`. Problems throw `LaunchRefusedError` with the list.
- The script runs in a temp copy with env `DEPLOYER_PRIVATE_KEY`, `PROJECT_FACTORY`, `LAUNCH_MANIFEST`,
  `CHAIN_ID` (plus `scriptEnv`). Addresses come from the script's named address returns (`--json`) and from
  CREATE/CREATE2 traces or `broadcast/<script>/<chainId>/run-latest.json`. Addresses are lowercase.
- `dryRun` without `rpcUrl`: compile and simulate in forge's in-memory EVM (simulation addresses, simulated gas);
  cost is computed when `gasPriceWei` is given. Without forge: a plan only.
- `dryRun` with `rpcUrl`: on-chain simulation without `--broadcast`; estimate from the dry-run broadcast file.
- Live: simulate → refuse if estimated gas × gas price > `gasCeilingWei` → `--broadcast --slow --with-gas-price`
  → parse the broadcast file; actual cost above the ceiling is reported in `notes` (trip the breaker).
  The private key is passed only through the child's env and is scrubbed from errors.

---------------------------------------------------------------------------------------------------------------

## Railway notes

**Services and storage.** The `services` process (Clerk, Records Office, Registrar) and `api` share storage:

- Volume: attach a Railway volume to the service that writes (mounted e.g. at `/data`) and set
  `STORAGE_DRIVER=local`, `STORAGE_DIR=/data/storage`. A Railway volume attaches to one service only; if both
  `api` (serving sites and artifacts) and `services` (publishing) need the bytes, use a bucket instead.
- Bucket: Railway Bucket, Cloudflare R2 or any S3-compatible store: `STORAGE_DRIVER=s3`, `S3_ENDPOINT`,
  `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` (`auto` for R2), and `S3_PUBLIC_URL`
  when the bucket has a public domain. Set `BLOB_PUBLIC_URL=https://api.comd.fun/artifacts` to hand out API
  URLs instead of bucket URLs.
- Sites: `SITES_DOMAIN=sites.comd.fun`; add the wildcard custom domain `*.sites.comd.fun` on the `api` service
  and route by Host header to `serveSite(store, label, path)`.

**Foundry in the Docker image** (for the `services` service; the Dockerfile lives in `infra/`):

```dockerfile
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates util-linux \
 && rm -rf /var/lib/apt/lists/*
# Foundry (pin a release)
RUN curl -fsSL https://foundry.paradigm.xyz | bash && /root/.foundry/bin/foundryup --install stable
ENV PATH=/root/.foundry/bin:$PATH FORGE_BIN=/root/.foundry/bin/forge
# Pre-fetch solc so offline Clerk builds resolve `solc_version = "0.8.26"` without network
RUN mkdir -p /root/.svm/0.8.26 \
 && curl -fsSL -o /root/.svm/0.8.26/solc-0.8.26 \
    https://binaries.soliditylang.org/linux-amd64/solc-linux-amd64-v0.8.26+commit.8a97fa7a \
 && chmod +x /root/.svm/0.8.26/solc-0.8.26
```

Check the solc build name against `https://binaries.soliditylang.org/linux-amd64/list.json` when bumping
versions, and pre-fetch every version the catalog's projects pin. `git` is required by `publishRepo`;
`util-linux` provides `unshare`. Railway containers usually do not permit unprivileged user namespaces: set
`SANDBOX_NET=env` there (the Clerk then blocks network by environment only, which is weaker; skills that do not
require network still run with `--offline` and npm offline mode).

**Secrets.** `GITHUB_TOKEN` (fine-grained, repo create + contents + pull requests on `GITHUB_ORG`),
`DEPLOYER_PRIVATE_KEY` (Registrar only; never passed to Clerk sandboxes), S3 keys. The Clerk's sandboxes never
inherit the service environment.

**Node.** Node 22.18+ runs `src/*.ts` directly; or run `npm run build` and import `@company/services/dist`.

## Tests

`npm test -w @company/services` covers: local and S3 blob stores (S3 against an in-process fake server that
verifies SigV4 signatures and injects a 503), the Clerk (allowed-path violations, deletions, symlinks, missing
outputs, renamed media, image/audio/video magic bytes, research citations and rubric, review/oracle/workflow
reports, an offline npm web build and a drainer site, Foundry pass / failing test / compile error / missing
forge, launch manifests, catalog lookup), site screening, publish and serve, repo publishing in dry-run and
against a fake GitHub API with a local bare git remote, Registrar plans, in-memory simulations, policy refusals
and broadcast parsing, and the skill catalog (51 skills, hashes, checker agreement).

Foundry tests use `FORGE_BIN` (default `~/.foundry/bin/forge`) and `SOLC_BIN` (default
`~/.svm/0.8.26/solc-0.8.26`) and are skipped when either is missing. The fixture
`test/fixtures/foundry-ok` builds offline: the tests point its `solc` at `SOLC_BIN` and set `offline = true`.
