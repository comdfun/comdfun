// Tabs with counts, a GET search form and a 25-row pager driven by `before` cursors kept in the URL.
import Link from "next/link";
import type { ReactNode } from "react";
import { fmtNum } from "@/lib/format";

export type Params = Record<string, string | string[] | undefined>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

export function hrefWith(base: string, params: Record<string, string | string[] | undefined | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => x && u.append(k, x));
    else u.set(k, v);
  }
  const s = u.toString();
  return s ? `${base}?${s}` : base;
}

export function Tabs({ base, tabs, active, keep }: { base: string; tabs: { key: string; label: string; n?: number | null }[]; active: string; keep?: Record<string, string | undefined> }) {
  return (
    <nav className="tabs" aria-label="Filter">
      {tabs.map((t) => (
        <Link key={t.key} className="tab" href={hrefWith(base, { ...keep, tab: t.key === tabs[0].key ? undefined : t.key })} aria-current={t.key === active ? "page" : undefined}>
          {t.label}
          {t.n != null && <span className="n">{fmtNum(t.n)}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function SearchForm({ action, q, hidden, placeholder = "Search", extra }: { action: string; q?: string; hidden?: Record<string, string | undefined>; placeholder?: string; extra?: ReactNode }) {
  return (
    <form className="search" action={action} method="get" role="search">
      {hidden && Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {extra}
      <label className="sr-only" htmlFor={`q-${action}`}>{placeholder}</label>
      <input id={`q-${action}`} type="search" name="q" defaultValue={q} placeholder={placeholder} maxLength={200} />
      <button className="btn sm" type="submit">Search</button>
    </form>
  );
}

/** Cursor pager: `b` holds the stack of `before` cursors; previous pops one, next pushes the last row's time. */
export function CursorPager({ base, keep, stack, nextCursor, shown, total, pageSize = 25 }: { base: string; keep: Record<string, string | undefined>; stack: string[]; nextCursor?: string | null; shown: number; total?: number | null; pageSize?: number }) {
  const page = stack.length;
  const from = shown ? page * pageSize + 1 : 0;
  const to = page * pageSize + shown;
  return (
    <nav className="pager" aria-label="Pages">
      {page > 0 ? <Link href={hrefWith(base, { ...keep, b: stack.slice(0, -1) })} rel="prev">← Previous</Link> : <span className="off">← Previous</span>}
      <span>
        {from}–{to}
        {total != null ? ` of ${fmtNum(total)}` : ""}
      </span>
      {nextCursor ? <Link href={hrefWith(base, { ...keep, b: [...stack, nextCursor] })} rel="next">Next →</Link> : <span className="off">Next →</span>}
    </nav>
  );
}

export function PagePager({ base, keep, page, totalPages, count, pageSize }: { base: string; keep: Record<string, string | undefined>; page: number; totalPages: number; count: number; pageSize: number }) {
  const from = count ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(count, page * pageSize);
  return (
    <nav className="pager" aria-label="Pages">
      {page > 1 ? <Link href={hrefWith(base, { ...keep, page: String(page - 1) })} rel="prev">← Previous</Link> : <span className="off">← Previous</span>}
      <span>{from}–{to} of {fmtNum(count)}</span>
      {page < totalPages ? <Link href={hrefWith(base, { ...keep, page: String(page + 1) })} rel="next">Next →</Link> : <span className="off">Next →</span>}
    </nav>
  );
}
