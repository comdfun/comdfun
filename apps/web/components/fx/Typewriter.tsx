import type { ReactNode } from "react";

/**
 * Server-rendered typewriter: each character is in the HTML (readable, indexable) and CSS reveals it after
 * `--d` ms with a block cursor that travels and then blinks at the end. Words never break mid-word.
 * Pass segments to colour words: [["Two thousand ", ""], ["counsel.", "w-gold"]].
 */
export function Typewriter({ segments, step = 42, start = 250, as = "h1", id, className }: { segments: [string, string?][]; step?: number; start?: number; as?: "h1" | "h2" | "p" | "span"; id?: string; className?: string }) {
  const Tag = as;
  // "\n" in a segment is a line break (rendered as <br>, read as a space)
  const text = segments.map((s) => s[0]).join("").replace(/\s*\n\s*/g, " ");
  let i = 0;
  const total = text.replace(/\s/g, "").length;
  const out: ReactNode[] = [];
  segments.forEach(([seg, cls], si) => {
    const words = seg.split(/(\s+)/);
    words.forEach((w, wi) => {
      if (!w) return;
      if (/^\s+$/.test(w)) {
        out.push(w.includes("\n") ? <br key={`${si}-${wi}`} /> : w);
        return;
      }
      out.push(
        <span key={`${si}-${wi}`} className={`wd ${cls ?? ""}`}>
          {[...w].map((ch, ci) => {
            const k = i++;
            return (
              <span key={ci} className={`ch${k === total - 1 ? " last" : ""}`} style={{ ["--d" as string]: k * step }}>
                {ch}
              </span>
            );
          })}
        </span>,
      );
    });
  });
  return (
    <Tag id={id} className={`tw ${className ?? ""}`} aria-label={text} style={{ ["--tw-step" as string]: `${step}ms`, ["--tw-start" as string]: `${start}ms` }}>
      <span aria-hidden="true">{out}</span>
    </Tag>
  );
}
