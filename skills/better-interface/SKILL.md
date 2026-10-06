---
id: better-interface
version: 1
kind: reference
origin: parity
role: reference
inference: none
tier: none
judge: none
requires: []
writes: none
checks: []
outputs: []
topics: [design, accessibility, responsive, evidence]
description: Six interface disciplines for building and reviewing websites, judged from rendered browser evidence.
---

# Better interfaces

## Purpose

A site that builds can still be unusable. This reference gives web steps a shared standard: six disciplines
to design against, and a requirement to judge them from rendered evidence (screenshots and measurements) rather
than from reading source. It also records the firm's own house style for sites published under its name.

## How to apply

While building, check each discipline at 375 px, 768 px and 1280 px widths. Before submitting, capture
screenshots at those widths into `artifacts/screenshots/` and fix what they show. Reviewers judge from the
screenshots and a local run of the export, citing the discipline by name.

## 1. Hierarchy

- One primary action per view, visually dominant; secondary actions quieter.
- Headings form an outline (`h1` once, then `h2`, `h3` in order). A reader skimming headings understands the page.
- Group related controls; separate unrelated ones with space before reaching for lines and boxes.

## 2. Typography

- Body text 16 px or larger, line length 45–80 characters, line height around 1.5.
- Few families, each with one job (the firm uses pixel display faces for headings and figures and a monospace
  for body).
- Numbers that are compared (balances, prices) use tabular figures and right alignment.

## 3. Colour and contrast

- Text contrast at least 4.5:1 (3:1 for large text and UI boundaries), measured, not guessed.
- Colour never carries meaning alone: pair it with text or an icon (rejected, accepted, pending).
- Define colours as tokens (CSS custom properties) and use them consistently.

## 4. Layout and responsiveness

- Mobile first: a single column at 375 px, a 16 px minimum side gutter, no horizontal scrolling.
- Touch targets at least 44 × 44 px with space between them.
- Tables become stacked rows or scroll inside their own container on narrow screens, never the whole page.

## 5. States and feedback

- Every interactive element has hover, focus-visible, active and disabled states.
- Every async view has loading, empty, error and success states, with the error stating what to do next.
- Wallet flows follow `eth-frontend-ux`.

## 6. Accessibility and motion

- Semantic HTML first (`button`, `a`, `nav`, `main`, `label`); ARIA only to fill gaps.
- Keyboard: everything reachable and operable, focus order matches visual order, focus never trapped.
- Images have alt text (empty `alt=""` for decoration). Respect `prefers-reduced-motion`; no autoplaying audio.

## Evidence

- Screenshots at 375, 768, 1280 px of each page and important state (PNG, full page).
- An automated accessibility pass (for example axe in a headless browser) with violations listed or fixed.
- A note of any discipline knowingly traded off and why.

## House style for sites under the firm's name

When the matter asks for the firm's look (or does not specify one for the firm's own pages): a colourful
arcade law firm on black. Pure black background `#000000`, panels `#08070B` / `#0F0D14`, rules `#25212E`; text
parchment `#F3EBD3`, muted `#9A9488`. Arcade accents, each section owning one: gold `#FFC83D` (primary actions,
$COMD, Counsel), cyan `#2DE2E6` (matters), violet `#9B5CFF` (rulings), orange `#FF8A1F` (filings), lime `#8CFF3A`
(retainers; accepted or signed states), pink `#FF4FD8` (retain the firm), crimson `#FF3B5C` (rejected or
failed). Each accent has a darker shade for pressed states and pixel drop shadows. Press Start 2P / Silkscreen
for headings and buttons (uppercase), VT323 for large figures, IBM Plex Mono for body. No rounded corners, 2 px
borders, stepped pixel corners, `image-rendering: pixelated` on pixel art. Voice: precise and dry, never hype.
Requesters' own sites follow their brief, not this style.

## Sources and freshness

Written for Company.md in 2026 from WCAG 2.2 (contrast, target size, focus), the firm's build spec (§3 look),
and common interface-design practice. WCAG thresholds are stable; tooling for evidence (browsers, axe) changes,
so record the tool versions used with the screenshots.
