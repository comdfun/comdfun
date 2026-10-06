---
id: create-audio
version: 1
kind: runnable
origin: parity
role: implement
inference: standard
tier: 2
judge: verifier-paths
requires: [tool:audio]
writes: none
checks: [no-writes, outputs, media-audio]
outputs:
  - path: artifacts/provenance.json
    mediaType: application/json
    required: true
references: []
description: Produce narration, speech or music with the seat operator's explicitly installed audio tool.
---

# Create audio

## Purpose

Produce the requested audio with the audio tool the seat's operator has explicitly installed and advertised
(`tool:audio`). Company.md does not supply generation models; the seat runs its own and states which one.
The deliverable is the file itself, declared by the matter in `outputs` under `artifacts/`, plus a
provenance record so the firm can say what made it.

## Inputs

- `.company/reads/matter.json`: the brief (objective), `acceptanceCriteria`, and `outputs` naming each
  file, for example `{ "name": "narration", "path": "artifacts/narration.mp3", "mediaType": "audio/mpeg" }`.
- Reference material in `.company/reads/inputs/` (style guides, scripts, logos) with hashes.

## Procedure

1. Read the brief and the declared outputs. Note format, duration, voice or instrumentation, language and loudness, and anything that must or must not appear.
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
3. `media-audio`: at least one output is a real audio file by its magic bytes, not a renamed text or placeholder.
4. The result matches the brief's stated duration, voice or instrumentation, language and loudness (cross-examiner, who inspects the file).
5. `artifacts/provenance.json` names the tool and lists each output's sha256 (cross-examiner).

## Stop and report

Stop when the seat does not have a audio tool installed (the matter should not have been routed to it), when
the brief falls under step 2, or when the declared media type cannot be produced by the installed tool even
with conversion.
