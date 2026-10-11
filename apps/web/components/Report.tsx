// The matter's written report, printed on the page. Until this existed the only way to read the thing you paid for
// was to find the right card in the exhibits and open raw markdown in a browser tab. The toolbar does the two things
// people actually want: put it on the clipboard, or take the file away.
import { renderMd } from "@/lib/md";
import { apiUrl } from "@/lib/links";
import { bytes } from "@/lib/format";
import { CopyButton } from "@/components/CopyButton";
import type { Deliverable } from "@/lib/types";

/** The report's own title line duplicates the matter caption above it, so it comes off. */
function strip(src: string): string {
  return src.replace(/^\s*#\s+[^\n]*\n+/, "").replace(/^#\s/gm, "## ");
}

export function Report({ d, jobId }: { d: Deliverable; jobId: string }) {
  const body = strip(d.text);
  const { nodes } = renderMd(body);
  return (
    <div className="report">
      <div className="report-bar">
        <span className="report-what">
          <b>A written report</b>
          <span className="muted small">
            {d.kind === "audit" ? "the panel's findings" : "filed by Counsel, checked by a second"} · {bytes(d.bytes)}
          </span>
        </span>
        <span className="report-acts">
          <CopyButton text={d.text} label="Copy" />
          <a className="btn sm" href={apiUrl(`/jobs/${jobId}/deliverable.md`)} download>Download</a>
        </span>
      </div>
      <div className="report-body doc-md">{nodes}</div>
      {d.truncated && (
        <p className="small muted report-cut">
          This is the first part of a long report. <a className="ext" href={apiUrl(`/jobs/${jobId}/deliverable.md`)}>Open the whole thing</a> to read the rest.
        </p>
      )}
    </div>
  );
}
