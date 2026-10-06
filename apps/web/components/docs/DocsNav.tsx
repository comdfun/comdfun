"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

export interface DocIndexEntry { slug: string; href: string; title: string; group: string; summary: string; text: string }

function snippet(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, 110);
  const s = Math.max(0, i - 40);
  return `${s ? "…" : ""}${text.slice(s, i + q.length + 70)}…`;
}

/** Docs sidebar: groups, the active page, and a client-side search over every page's text ("/" to focus). */
export function DocsNav({ index, groups }: { index: DocIndexEntry[]; groups: readonly string[] }) {
  const path = usePathname() || "/docs";
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => setOpen(false), [path]);
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    const words = t.split(/\s+/);
    return index
      .map((d) => {
        const hay = `${d.title} ${d.summary} ${d.text}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return null;
        const score = (d.title.toLowerCase().includes(t) ? 10 : 0) + (d.summary.toLowerCase().includes(t) ? 4 : 0) + words.reduce((a, w) => a + hay.split(w).length - 1, 0);
        return { d, score };
      })
      .filter((x): x is { d: DocIndexEntry; score: number } => !!x)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [q, index]);
  const active = (href: string) => (href === "/docs" ? path === "/docs" || path === "/docs/introduction" : path === href);
  return (
    <aside className={`docs-side ${open ? "open" : ""}`}>
      <div className="docs-search">
        <label className="sr-only" htmlFor="docs-q">Search the docs</label>
        <input ref={input} id="docs-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the docs" autoComplete="off" />
        <kbd aria-hidden="true">/</kbd>
        {q.trim().length >= 2 && (
          <div className="docs-hits" role="listbox" aria-label="Search results">
            {hits.length === 0 && <div className="small muted" style={{ padding: 10 }}>No page mentions “{q}”.</div>}
            {hits.map(({ d }) => (
              <Link key={d.href} href={d.href} className="docs-hit" onClick={() => setQ("")}>
                <span className="docs-hit-t">{d.title}<span className="docs-hit-g">{d.group}</span></span>
                <span className="docs-hit-s">{snippet(d.text, q.trim().split(/\s+/)[0])}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="docs-menu-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Close contents" : "Contents"}</button>
      <nav className="docs-groups" aria-label="Documentation">
        {groups.map((g) => (
          <div key={g} className="docs-group">
            <div className="docs-group-h">{g}</div>
            {index.filter((d) => d.group === g).map((d) => (
              <Link key={d.href} href={d.href} aria-current={active(d.href) ? "page" : undefined}>{d.title}</Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
