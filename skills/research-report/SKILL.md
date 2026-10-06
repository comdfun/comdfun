---
id: research-report
version: 1
kind: runnable
origin: parity
role: implement
inference: standard
tier: 2
judge: verifier-paths
requires: [network]
writes: none
checks: [no-writes, outputs, research-citations]
outputs:
  - path: artifacts/report.md
    mediaType: text/markdown
    required: true
  - path: artifacts/sources.json
    mediaType: application/json
    required: false
references: [defi-native, eth-l2s]
description: Research a question and deliver a reusable report with sources and a frank account of uncertainty.
---

# Research report

## Purpose

Answer a question with a report another reader can check: claims tied to sources, numbers with dates,
and a section on what is uncertain or unknown. On `template: "research"` matters several seats write
reports independently and a panel compares them against the rubric, so a report that rests on one source
or hides its uncertainty scores poorly.

## Inputs

- `.company/reads/matter.json`: the question (objective, up to 4,000 characters), `minCitations`,
  `rubric.contains` (points the report must address) and `rubric.mayNotRestOn` (sources or claims it may
  not depend on).
- Attached inputs in `.company/reads/inputs/` if any.

## Procedure

1. Restate the question and split it into sub-questions. Decide what evidence would answer each.
2. Search primary sources first: official documentation, contracts and explorers, filings, papers, data
   dashboards. Use secondary sources to find primary ones, not as final authority.
3. For every factual claim keep the URL and the date accessed. For on-chain facts, give the chain, address
   and block. Prefer two independent sources for anything load-bearing.
4. Write the report in markdown with this structure: `# Title`, `## Answer` (short, direct), `## Findings`
   (one subsection per sub-question, claims with inline links), `## Uncertainty and limitations`,
   `## Sources` (numbered list of every URL with access date).
5. Address every `rubric.contains` point explicitly, using its wording in a heading or sentence. Do not
   rest any conclusion on a `rubric.mayNotRestOn` item.
6. Optionally write `artifacts/sources.json`: `[{ "url", "title", "accessed", "supports": ["claim"] }]`.

## Outputs

- `artifacts/report.md` (required), structured as in step 4.
- `artifacts/sources.json` (optional).

## Acceptance checks

1. `no-writes`: only `artifacts/` changed.
2. `outputs`: `artifacts/report.md` exists and is markdown.
3. `research-citations`: the report cites at least `minCitations` distinct URLs and contains every
   `rubric.contains` phrase.
4. The report has an uncertainty section that names at least one thing the sources do not settle
   (research panel).
5. No conclusion depends on a `rubric.mayNotRestOn` source (research panel).

## Stop and report

Stop when the question asks for personal data about a private individual, for legal or investment advice
framed as a recommendation to act, or when sources needed to answer are paywalled or unreachable (say which).
