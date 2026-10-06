---
id: import-site
version: 1
kind: runnable
origin: parity
role: implement
inference: standard
tier: 2
judge: verifier-paths
requires: [network]
writes: any
checks: [paths, web-build, site-screen]
outputs: []
references: [better-interface]
description: Build the static export of a website somebody else wrote, from their repository as it stands.
---

# Import a site

## Purpose

The requester has a site in a repository and wants it hosted by the firm. This step builds it as it is,
producing a static export the Records Office can publish. It changes only what is needed for a static
build to succeed and to work under a subdomain; it is not a redesign.

## Inputs

- `.company/reads/matter.json`: `repoUrl`, `baseCommit`, optional subdirectory, desired label.
- The repository at that commit.

## Procedure

1. Identify the framework (Vite, Next.js static export, Astro, plain HTML, Create React App) and its build
   command and output directory.
2. Install with the lockfile (`npm ci`, or the lockfile's package manager via `corepack`). If there is no
   lockfile, install once, commit the generated `package-lock.json`, and note it.
3. Make the minimum changes for a static, relocatable export: relative base path, static export mode
   (`output: "export"` for Next.js), no server routes, no environment secrets. List each change.
4. Make the export land in `dist/` (adjust the build script or add a copy step) so hosting is uniform.
5. Build, serve `dist/` locally, click through the main routes, and fix only breakages caused by static
   hosting (absolute paths, missing fallback).

## Outputs

The repository with the minimal build changes; `dist/` produced by `npm run build`; the list of changes in
the commit message.

## Acceptance checks

1. `paths`: changes are limited to build configuration and the files listed in the commit message.
2. `web-build`: `npm ci && npm run build` produces `dist/index.html` in the Clerk's sandbox.
3. `site-screen`: the export passes the content screen.
4. Visible content is the requester's, unchanged except where static hosting forced it (cross-examiner
   compares rendered pages with the original).

## Stop and report

Stop when the site needs a server at runtime (API routes, server-side rendering on request, auth), when
the repository cannot be fetched at the pinned commit, or when its licence does not allow redistribution.
