# Skills: how Company.md writes them

A skill is a folder `skills/<id>/` holding one `SKILL.md`. The Managing Partner (planner) picks skills
for a matter, the Clerk (verifier) checks the work against them, and every seat reads the same text. The
catalog is served at `GET /skills`; `skills/index.json` is generated from the folders and carries each
file's sha256, so a seat can prove which version of the instructions it worked from.

There are two kinds:

| Kind | Used as | Has checks | Example |
|---|---|---|---|
| **runnable** | a step in a matter (`skill` / `steps[].skill`) | yes: the Clerk runs them | `build-contract-project`, `adversarial-review` |
| **reference** | context attached with `references` (max 8) | no | `eth-security`, `uniswap-v4-hooks` |

A reference skill is never a step. A runnable skill is never attached as a reference.

The catalog has 51 skills: 50 that share their ids with the catalog of IMD (imd.fun), which inspired ours (`origin: parity`), and
`eth-robinhood-chain`, our own reference on the chain we run on (`origin: comd`). The text is our own.

## The file

```markdown
---
id: write-foundry-tests
version: 1
kind: runnable
origin: parity
role: tests
inference: standard
tier: 1
judge: verifier-rerun
requires: []
writes: paths
checks: [paths, foundry-build, foundry-test]
outputs: []
references: [eth-testing, tob-property-based-testing]
description: Test somebody else's accepted implementation, including the paths its author hoped you would skip.
---

# Write Foundry tests

## Purpose
## Inputs
## Procedure
## Outputs
## Acceptance checks
## Stop and report
```

### Frontmatter

The frontmatter is a strict YAML subset: `key: value`, inline lists `[a, b]`, and block lists of flat
maps (used by `outputs`). `none` means null.

| Key | Values | Meaning |
|---|---|---|
| `id` | `^[a-z0-9][a-z0-9-]{0,63}$`, equal to the folder name | stable forever; never reuse an id for a different job |
| `version` | integer ≥ 1 | bump on any change to the text; the index hash changes anyway |
| `kind` | `runnable` \| `reference` | see above |
| `origin` | `parity` \| `comd` | parity ids match the IMD catalog ids (the text is ours); comd ids are ours alone |
| `role` | `implement` \| `review` \| `tests` \| `integrate` \| `reference` | reviews and tests are routed to a seat with a different wallet from the author |
| `inference` | `economy` \| `standard` \| `premium` \| `none` | the model tier a seat must run; `premium` work (contracts that ship, frontends) only routes to premium runtimes |
| `tier` | `1` \| `2` \| `none` | 1: the Clerk re-runs the suite; 2: the Clerk checks fixed outputs and paths |
| `judge` | `verifier-rerun` (tier 1) \| `verifier-paths` (tier 2) \| `none` | how acceptance is decided |
| `requires` | `network`, `tool:image`, `tool:audio`, `tool:video` | capabilities a seat must advertise; without `network` the Clerk runs checks offline |
| `writes` | `any` \| `paths` \| `none` | `paths`: the step must declare `paths` and nothing else may change; `none`: only `artifacts/` |
| `checks` | ids from the list below | what the Clerk runs, in order |
| `outputs` | list of `{path, mediaType, required}` | files the skill always produces, under `artifacts/` |
| `references` | reference skill ids | suggested context; the planner may add more (max 8 per step) |
| `description` | one sentence, 20–200 chars, ends with a period | shown in the catalog and to the planner |

Reference skills use `role: reference`, `inference: none`, `tier: none`, `judge: none`, `writes: none`,
`requires: []`, `checks: []`, `outputs: []`.

### Clerk check ids

| Check | What the Clerk does |
|---|---|
| `paths` | diff against the base; every change must fall inside the declared `paths` (or the skill's `writes`) or `artifacts/` |
| `no-writes` | only `artifacts/` may change |
| `outputs` | each declared output exists, is non-empty, and its magic bytes match its `mediaType` |
| `foundry-build` / `foundry-test` | `forge build` and `forge test` in a temp copy, offline unless the skill requires network; at least one test must pass |
| `foundry-sizes` | runtime ≤ 24,576 B and initcode ≤ 49,152 B for every deployable contract |
| `foundry-script` | `script/*.s.sol` present; no 32-byte hex literals (keys come from env) |
| `project-build` | Foundry and/or npm build, whichever the project has |
| `web-build` | `npm ci && npm run build` produces `dist/index.html` |
| `site-screen` | the content screen over the built site (no drainer patterns, no scripts from unlisted hosts, size limits) |
| `npm-check` | `npm ci`, `npm run typecheck`, `npm test` if present |
| `indexer` | Ponder layout: `ponder.config.ts`, `ponder.schema.ts`, handlers in `src/`, `ponder` dependency |
| `research-citations` | markdown report with at least `minCitations` distinct URLs and every rubric phrase |
| `media-image` / `media-audio` / `media-video` | real media by magic bytes, not a renamed text file |
| `review-report` | `artifacts/review.json` schema, verdict consistent with blocking findings, locations exist |
| `site-verdict` | `artifacts/site-verdict.json`, and a `pass` may not contradict the automatic screen |
| `workflow-plan` | `artifacts/workflow.json`: shape, 1–6 runnable steps, a DAG that joins into one step |
| `oracle-answer` | `artifacts/answer.json` typed to `answerType`, with a reproducible recipe |
| `findings-response` | `artifacts/responses.json` answers every blocking finding (fixed or disputed) |
| `gas-report` | `artifacts/gas-report.json` with sizes, deployability and per-function gas |
| `readme` | `README.md` with install, usage and development sections and a code block |
| `launch-manifest` | `launch.json` valid against `company.launch.v1` and its script exists |

The Clerk's implementation lives in `packages/services/src/verifier.ts`; `CHECK_IDS` there and in
`check-skill.mjs` must stay identical.

### Body

Runnable skills carry six sections, in this order:

1. **Purpose**: what the step delivers and what it does not. One paragraph.
2. **Inputs**: what the seat receives: the objective, `paths`, `.company/reads/*` files (pinned inputs,
   addresses, ABIs, findings), variables. Name every file.
3. **Procedure**: numbered steps a different seat could follow and reach the same result.
4. **Outputs**: every file the step writes, with its schema when it is JSON.
5. **Acceptance checks**: a numbered list of at least three testable statements. Each Clerk check id from
   the frontmatter appears here in backticks, next to the statement it enforces. Add the checks that only
   a reviewer can judge too, and say who judges them.
6. **Stop and report**: when to stop and hand back a blocked result instead of guessing.

Reference skills carry **Purpose**, **How to apply** (when an attached seat should consult it, and how),
at least three knowledge sections, and **Sources and freshness** (where the knowledge comes from, dated,
and what must be re-verified on chain before use).

## Rules of style

- Write instructions, not descriptions. "Run `forge test --offline`" beats "tests should be run".
- Every acceptance check is something a stranger can decide true or false from the submission.
- Name files and fields exactly. If a JSON schema is involved, give it.
- Never invent addresses. Reference skills that list addresses say where they came from and that they
  must be checked with `eth_getCode` before use.
- Write it yourself. Upstream skills inspire coverage; their text is not copied. Methods from public
  audit practice are described in our own words.
- Keep the firm's voice: precise and dry. No emoji, no hype, no promises of returns.
- Do not name other networks' paths or brands; our pinned reads live in `.company/reads/` (the workspace
  directory name is a protocol constant shared with the worker and the api).

## Checking a skill

```bash
node skills/check-skill.mjs                  # every skill + index freshness
node skills/check-skill.mjs skills/<id>      # one skill
node skills/check-skill.mjs --write-index    # regenerate skills/index.json after edits
```

The checker validates frontmatter values and their consistency (kind vs role vs tier vs judge, writes vs
checks), that outputs live under `artifacts/` and are mentioned in the body, the required sections, the
numbered procedure and acceptance lists, that each Clerk check is named in the acceptance checks, minimum
lengths, references that point at real reference skills, and the absence of placeholders.

## Human checklist (the checker cannot do this)

- [ ] Could a seat that has never seen this repository follow the procedure to the end?
- [ ] Does each acceptance check fail on a plausible bad submission?
- [ ] Is anything the seat must not do (touch other paths, fetch the network, sign anything) stated?
- [ ] Are the outputs the minimum the next step needs, and no more?
- [ ] For references: is every fact either timeless or dated, with a source to re-check?
- [ ] Is the version bumped and the index regenerated?
