// A small Markdown renderer for the docs (server-side): ## / ### headings with anchors, paragraphs, - lists,
// 1. lists, > notes, ``` code fences (with copy), | tables |, **bold**, `code`, [links](url). Deliberately tiny:
// the docs are written for it.
import Link from "next/link";
import type { ReactNode } from "react";
import { CodeBlock } from "@/components/CopyButton";

export const slugify = (s: string) => s.toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${n++}`;
    if (t.startsWith("**")) out.push(<strong key={k}>{inline(t.slice(2, -2), k)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="inl">{t.slice(1, -1)}</code>);
    else {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!;
      const href = mm[2];
      out.push(href.startsWith("/") || href.startsWith("#") ? <Link key={k} href={href}>{inline(mm[1], k)}</Link> : <a key={k} className="ext" href={href} target="_blank" rel="noreferrer">{inline(mm[1], k)}</a>);
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export interface Heading { id: string; text: string; level: number }

export function renderMd(src: string): { nodes: ReactNode[]; headings: Heading[] } {
  const lines = src.replace(/\r/g, "").split("\n");
  const nodes: ReactNode[] = [];
  const headings: Heading[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim() || undefined;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      nodes.push(<CodeBlock key={k++} code={buf.join("\n")} lang={lang} />);
      continue;
    }
    const h = /^(#{2,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      const id = slugify(text);
      headings.push({ id, text: text.replace(/`/g, ""), level });
      const Tag = (level === 2 ? "h2" : level === 3 ? "h3" : "h4") as "h2";
      nodes.push(<Tag key={k++} id={id} className="dh"><a className="anchor" href={`#${id}`} aria-label={`Link to ${text}`}>#</a>{inline(text, `h${k}`)}</Tag>);
      i++;
      continue;
    }
    if (line.startsWith("> ")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) buf.push(lines[i++].slice(2));
      const [first, ...rest] = buf.join(" ").split(/^(\w+:)\s*/);
      void first;
      const label = /^(Note|Warning|Tip|Unaudited):/.exec(buf[0])?.[1];
      const body = label ? buf.join(" ").slice(label.length + 1).trim() : buf.join(" ");
      nodes.push(<div key={k++} className={`callout ${label ? label.toLowerCase() : ""}`}>{label && <span className="callout-h">{label}</span>}<p>{inline(body, `q${k}`)}</p></div>);
      void rest;
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      nodes.push(
        <div key={k++} className="table-wrap"><table className="ftable dtable"><thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `th${k}${j}`)}</th>)}</tr></thead>
          <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `td${k}${ri}${j}`)}</td>)}</tr>)}</tbody></table></div>,
      );
      continue;
    }
    if (/^(-|\d+\.)\s/.test(line)) {
      const ordered = /^\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^(-|\d+\.)\s/.test(lines[i])) {
        let it = lines[i].replace(/^(-|\d+\.)\s+/, "");
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) it += ` ${lines[i++].trim()}`;
        items.push(it);
      }
      const L = ordered ? "ol" : "ul";
      nodes.push(<L key={k++} className={ordered ? "dol" : "dul"}>{items.map((it, j) => <li key={j}>{inline(it, `li${k}${j}`)}</li>)}</L>);
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,4}\s|```|> |\||-\s|\d+\.\s)/.test(lines[i])) buf.push(lines[i++].trim());
    nodes.push(<p key={k++}>{inline(buf.join(" "), `p${k}`)}</p>);
  }
  return { nodes, headings };
}

/** Plain text for the client-side search index. */
export function mdText(src: string) {
  return src
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`|]/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
