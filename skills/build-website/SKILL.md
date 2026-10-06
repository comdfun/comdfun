---
id: build-website
version: 1
kind: runnable
origin: parity
role: implement
inference: premium
tier: 2
judge: verifier-paths
requires: [network]
writes: any
checks: [paths, web-build, site-screen]
outputs: []
references: [better-interface, eth-frontend-ux]
description: Build a responsive Vite and React website, validate it on the seat, and deliver its source and static export.
---

# Build a website

## Purpose

Deliver a static website: Vite + React + TypeScript source that builds with `npm ci && npm run build` into
`dist/`, ready for the Records Office to host at `https://<label>.sites.comd.fun`. No server, no secrets,
no runtime calls to APIs the requester did not name. This is premium work: it routes only to seats on
premium runtimes, and the result is judged by how it renders, not only by whether it builds.

## Inputs

- `.company/reads/matter.json`: objective (what the site is for, its pages and content), optional site label,
  `acceptanceCriteria`.
- Attached content in `.company/reads/inputs/` (copy, images, logos) with their hashes.
- References: `better-interface` for design discipline and evidence; `eth-frontend-ux` if the site touches a
  wallet.

## Procedure

1. Scaffold with Vite's React + TypeScript template. Commit `package-lock.json`; pin exact versions.
2. Write the content first (headings, copy, calls to action) in a single `src/content.ts`, then the layout.
   Every page works at 375 px, 768 px and 1280 px widths, with a 16 px minimum side gutter and no horizontal
   scroll.
3. Use relative asset paths (`base: "./"` in `vite.config.ts`) so the export works under any host. Use
   client-side routing only with a fallback that works when `index.html` serves unknown paths.
4. Load scripts only from the bundle. Web fonts may come from Google Fonts; no other third-party script or
   tracking unless the matter names it.
5. Accessibility: semantic landmarks, alt text, visible focus, colour contrast at least 4.5:1 for body text,
   `prefers-reduced-motion` respected.
6. Build, then serve `dist/` locally and capture screenshots at the three widths into
   `artifacts/screenshots/` (PNG). Fix anything that overflows, overlaps or is unreadable.
7. Write a short `README.md`: how to develop, build and where the export lands.

## Outputs

- Site source (`package.json`, `package-lock.json`, `vite.config.ts`, `index.html`, `src/**`, `public/**`).
- `dist/` is produced by the build; the Clerk rebuilds it rather than trusting a committed copy.
- `artifacts/screenshots/*.png` at the three widths.

## Acceptance checks

1. `paths`: changes stay in the project tree (and declared paths when given).
2. `web-build`: `npm ci && npm run build` succeeds in the Clerk's sandbox and produces `dist/index.html`.
3. `site-screen`: the built site passes the content screen: no scripts from unlisted hosts, no drainer
   patterns, size within limits.
4. Screenshots exist for 375, 768 and 1280 px and show no horizontal overflow (cross-examiner).
5. Every page named in the objective is reachable from the home page navigation (cross-examiner).

## Stop and report

Stop when the objective requires a backend, user accounts or secrets; when requested content is
impersonation of a real organisation; or when attached inputs are missing or their hashes do not match.
