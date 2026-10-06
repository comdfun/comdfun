---
id: site-content-check
version: 1
kind: runnable
origin: parity
role: review
inference: standard
tier: 1
judge: verifier-rerun
requires: []
writes: none
checks: [no-writes, site-verdict]
outputs:
  - path: artifacts/site-verdict.json
    mediaType: application/json
    required: true
references: [eth-frontend-ux]
description: Read a website that is about to be hosted under the firm's domain for content that must not be hosted.
---

# Site content check

## Purpose

Every site the Records Office hosts at `<label>.sites.comd.fun` is published under the firm's name. Before
publishing, an independent seat reads the built site and rules `pass` or `block`. An automatic screen has
already run (wallet-drainer patterns, scripts from unlisted hosts, executables, size limits); this step adds
the judgement a pattern match cannot: phishing, impersonation, deceptive claims, illegal content.

## Inputs

- `.company/reads/site/`: the static export exactly as it will be published.
- `.company/reads/screen.json`: the automatic screen result `{ verdict, findings[], stats }`.
- `.company/reads/matter.json`: what the site was supposed to be.

## Procedure

1. Read `screen.json`. A `block` from the screen cannot be overruled by this step; your verdict must also be
   `block`, with the screen's rules restated as reasons.
2. Open `index.html` and every HTML page; read the visible text and the scripts' behaviour around wallet
   calls. Look for: requests for seed phrases or private keys; signature requests that are not explained on
   the page (blind `eth_sign`, unlimited approvals, Permit2 batch permits to unknown spenders); transfers to
   hard-coded addresses; impersonation of a real company, exchange or protocol (logos, names, "official");
   claims of guaranteed returns; content that is illegal to host (malware, sexual content involving minors,
   doxxing, incitement).
3. Check that third-party brands are used descriptively only. A site mentioning Robinhood Chain must not
   suggest affiliation with Robinhood.
4. Compare with the matter: a site that is materially different from what was requested (for example a
   token sale page when a documentation site was asked for) is blocked with that reason.
5. Rule: `block` if anything in steps 1–4 applies, else `pass`. Reasons are short, specific and cite the file.

## Outputs

`artifacts/site-verdict.json`:
`{ "verdict": "pass" | "block", "reasons": ["index.html: asks for a recovery phrase in #restore-form"],
"screen": { "verdict": "...", "rules": ["..."] } }`.

## Acceptance checks

1. `no-writes`: only `artifacts/` changed; the site files are untouched.
2. `site-verdict`: `artifacts/site-verdict.json` exists, the verdict is `pass` or `block`, a `block` has at
   least one reason, and a `pass` never contradicts a `block` from the Clerk's own re-run of the screen.
3. Each reason names a file (and an element or line when possible) so the requester can act on it
   (Managing Partner reviews disputed blocks).

## Stop and report

Stop when the site directory is missing or empty, or when the site needs a running backend to show its
content (report that the static export cannot be judged as delivered).
