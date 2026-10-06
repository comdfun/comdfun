---
id: create-image
version: 1
kind: runnable
origin: parity
role: implement
inference: standard
tier: 2
judge: verifier-paths
requires: [tool:image]
writes: none
checks: [no-writes, outputs, media-image]
outputs:
  - path: artifacts/provenance.json
    mediaType: application/json
    required: true
references: [better-interface]
description: Produce the requested image with the seat operator's explicitly installed image tool.
---

# Create an image

## Purpose

Produce the requested image with the image tool the seat's operator has explicitly installed and advertised
(`tool:image`). Company.md does not supply generation models; the seat runs its own and states which one.
The deliverable is the file itself, declared by the matter in `outputs` under `artifacts/`, plus a
provenance record so the firm can say what made it.

## Inputs

- `.company/reads/matter.json`: the brief (objective), `acceptanceCriteria`, and `outputs` naming each
  file, for example `{ "name": "cover", "path": "artifacts/cover.png", "mediaType": "image/png" }`.
- Reference material in `.company/reads/inputs/` (style guides, scripts, logos) with hashes.

## Procedure

1. Read the brief and the declared outputs. Note format, dimensions, aspect ratio, subject, palette and text, and anything that must or must not appear.
2. Refuse the brief (stop, below) if it asks for a real person's likeness or voice without evidence of
   consent, sexual content, content that impersonates a real organisation, or copyrighted characters,
   music or footage the requester has not licensed.
3. Generate with the installed tool. Keep the exact tool name, version or model id, and the prompt or
   parameters used.
4. Inspect the result yourself (view, listen or watch it in full). Regenerate until it meets every
   acceptance criterion; do not deliver the first attempt by default.
5. Export to the declared path and media type exactly. Convert with a standard encoder if the tool's
   native format differs; never rename a file to a different extension without converting it.
6. Write `artifacts/provenance.json`: `{ "tool": "...", "model": "...", "parameters": {...}, "prompt": "...",
   "inputs": ["sha256 of each input used"], "outputs": [{ "path": "...", "sha256": "..." }] }`.

## Outputs

- Each declared output under `artifacts/`, in the declared media type.
- `artifacts/provenance.json` as above.

## Acceptance checks

1. `no-writes`: only `artifacts/` changed.
2. `outputs`: every declared output exists, is non-empty, and its magic bytes match its declared media type.
3. `media-image`: at least one output is a real image file by its magic bytes, not a renamed text or placeholder.
4. The result matches the brief's stated dimensions, aspect ratio, subject, palette and text (cross-examiner, who inspects the file).
5. `artifacts/provenance.json` names the tool and lists each output's sha256 (cross-examiner).

## Stop and report

Stop when the seat does not have a image tool installed (the matter should not have been routed to it), when
the brief falls under step 2, or when the declared media type cannot be produced by the installed tool even
with conversion.
