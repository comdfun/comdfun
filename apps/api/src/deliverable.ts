/**
 * The written deliverable of a matter: the thing a person who paid for it actually wants to read.
 *
 * A research matter ends with `artifacts/report.md` attached to an accepted submission. Until now the only way to
 * read it was to find the right card in the exhibits and open raw markdown in a browser tab, which is no way to
 * hand someone a report. This picks the one written document out of a matter and serves it as text, so the matter
 * page can print it, offer it as a download, and put it on the clipboard.
 *
 * Only artifacts on *accepted* nodes count, and for a panel only the winner's: a rejected draft is not the report.
 */
import type { SubmissionRecord } from "@company/protocol";
import type { App } from "./app.ts";
import type { JobX } from "./engine.ts";

type S = SubmissionRecord & { id: string };

/** How much text a page is handed at once. Longer reports are cut here and the download link carries the whole thing. */
export const DELIVERABLE_TEXT_LIMIT = 400_000;

export interface DeliverableRef {
  /** "artifact" — a markdown file the Counsel filed; "audit" — the report the panel's judge wrote. */
  kind: "artifact" | "audit";
  name: string;
  path: string;
  mediaType: string;
  hash: string | null;
  bytes: number;
  nodeKey: string | null;
}

export interface Deliverable extends DeliverableRef {
  text: string;
  truncated: boolean;
}

const isMarkdown = (f: { path: string; mediaType: string }) =>
  /^text\/(markdown|x-markdown)\b/i.test(f.mediaType) || /\.(md|markdown)$/i.test(f.path);

/** The written deliverable's identity, without reading its bytes. null when the matter has produced no document. */
export function deliverableRef(app: App, j: JobX): DeliverableRef | null {
  const found: DeliverableRef[] = [];
  for (const n of j.nodes) {
    if (n.state !== "accepted" || !n.submissionHash) continue;
    if (n.kind === "panel" && j.panel && j.panel.winner !== n.key) continue;
    const s = app.store.c<S>("submissions").get(n.submissionHash);
    for (const a of s?.artifacts ?? []) {
      if (!isMarkdown(a)) continue;
      found.push({ kind: "artifact", name: a.name, path: a.path, mediaType: a.mediaType, hash: a.hash, bytes: a.bytes, nodeKey: n.key });
    }
  }
  // report.md is the convention; a review.md or notes.md is a by-product, so it only wins if nothing else is there
  const rank = (d: DeliverableRef) => (/(^|\/)report\.md$/i.test(d.path) ? 0 : /review|findings|notes/i.test(d.path) ? 2 : 1);
  found.sort((a, b) => rank(a) - rank(b) || b.bytes - a.bytes);
  if (found.length) return found[0];
  if (j.report) return { kind: "audit", name: "report", path: "report.md", mediaType: "text/markdown", hash: null, bytes: Buffer.byteLength(j.report), nodeKey: null };
  return null;
}

/** The written deliverable with its text. null when there is none, or when its bytes have gone missing from storage. */
export async function deliverable(app: App, j: JobX, limit = DELIVERABLE_TEXT_LIMIT): Promise<Deliverable | null> {
  const ref = deliverableRef(app, j);
  if (!ref) return null;
  let full: string;
  if (ref.kind === "audit") full = j.report ?? "";
  else {
    const obj = ref.hash ? await app.blobs.get(ref.hash) : null;
    if (!obj) return null;
    full = Buffer.from(obj.data).toString("utf8");
  }
  if (!full.trim()) return null;
  const text = full.length > limit ? full.slice(0, limit) : full;
  return { ...ref, bytes: Buffer.byteLength(full), text, truncated: text.length < full.length };
}

/** A file name for the download: `matter-<8 hex>-report.md`. */
export function deliverableFilename(j: JobX): string {
  return `matter-${j.id.replace(/-/g, "").slice(0, 8)}-report.md`;
}
