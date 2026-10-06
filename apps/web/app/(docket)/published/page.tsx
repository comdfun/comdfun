import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { ago, bytes, caption } from "@/lib/format";
import { artifactUrl, apiUrl } from "@/lib/links";
import { PageHead, Addr, Avatars, OffRecord, Empty, Stamp } from "@/components/ui";
import { Tabs, SearchForm, PagePager, one, type Params } from "@/components/Listing";
import type { Publication } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Filings" };

const TYPES = [
  ["all", "All"], ["tokens", "Tokens"], ["contracts", "Contracts"], ["sites", "Sites"], ["research", "Research"], ["code", "Code"], ["media", "Media"], ["audits", "Audits"],
] as const;
const PAGE = 25;

function Card({ p, n }: { p: Publication; n: number }) {
  const jobId = p.id.replace(/^job:/, "");
  return (
    <article className="card" style={{ display: "grid", gap: 10, alignContent: "start" }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
        <Stamp>Exhibit {n}</Stamp>
        <span className="row" style={{ gap: 4 }}>{p.types.map((t) => <span className="tag" key={t}>{t}</span>)}</span>
      </div>
      <h3 style={{ fontSize: 13, margin: 0, textTransform: "none", fontFamily: "var(--font-mono)", fontWeight: 500 }}>
        <Link href={`/jobs/${jobId}`}>{caption(p.title, 120)}</Link>
      </h3>
      <div className="small muted">
        filed {ago(p.publishedAt)} · paid by <Addr a={p.paidBy} />
      </div>
      {p.seats && p.seats.length > 0 && <Avatars ids={p.seats} max={6} link />}
      <ul className="small" style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
        {p.release?.token && (
          <li>
            token <span className="brass">${p.release.token.symbol}</span> · <Addr a={p.release.token.address} chainId={p.release.chainId} /> · <Link href={`/launches/${p.release.launchId}`}>incorporation #{p.release.launchNumber}</Link>
          </li>
        )}
        {p.contracts.filter((c) => c.role !== "token").slice(0, 4).map((c) => (
          <li key={c.address}>{c.name} · <Addr a={c.address} chainId={c.chainId} /></li>
        ))}
        {p.sites.map((s) => (<li key={s.url}>site · <a className="ext" href={s.url} target="_blank" rel="noreferrer">{s.url.replace(/^https?:\/\//, "")}</a></li>))}
        {p.code.map((c) => (
          <li key={c.jobId}>
            {c.skill ? c.skill.replace(/-/g, " ") : "code"} · {c.repoUrl ? <a className="ext" href={c.pullRequestUrl ?? c.repoUrl} target="_blank" rel="noreferrer">{c.pullRequestUrl ? "pull request" : "repository"}</a> : "—"}
          </li>
        ))}
        {p.media.flatMap((m) => m.files.slice(0, 3).map((f) => (
          <li key={f.hash}><a className="ext" href={artifactUrl(f.hash)} target="_blank" rel="noreferrer">{f.path.replace("artifacts/", "")}</a> · {f.mediaType.split("/")[1]?.toUpperCase()} · {bytes(f.bytes)}</li>
        )))}
        {p.research.map((r) => (<li key={r.jobId}>research · {r.steps} step{r.steps === 1 ? "" : "s"}{r.panel ? " · panel" : ""} · <a className="ext" href={apiUrl(`/jobs/${r.jobId}/result`)} target="_blank" rel="noreferrer">report</a></li>))}
        {p.audits.map((a) => (<li key={a.jobId}>audit · {a.findings ?? 0} findings · <a className="ext" href={apiUrl(`/jobs/${a.jobId}/report.md`)} target="_blank" rel="noreferrer">report.md</a></li>))}
      </ul>
      <Link className="small" href={`/jobs/${jobId}`}>Details →</Link>
    </article>
  );
}

export default async function Published({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const type = TYPES.find(([k]) => k === one(sp.tab))?.[0] ?? "all";
  const q = one(sp.q).slice(0, 200);
  const sort = one(sp.sort) === "oldest" ? "oldest" : "newest";
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const [list, counts] = await Promise.all([api.publications({ q, type, sort, page, pageSize: PAGE }), api.publicationCounts(q || undefined)]);
  const keep = { q: q || undefined, tab: type === "all" ? undefined : type, sort: sort === "newest" ? undefined : sort };
  return (
    <>
      <PageHead crumbs={[{ label: "The Docket", href: "/jobs" }, { label: "Filings" }]} title="Filings" lede={<>What the firm has filed: <strong>tokens, contracts, sites, research, code, media and audits</strong>, each an exhibit of an accepted matter.</>} />
      <div className="toolbar">
        <Tabs base="/published" active={type} keep={{ q: keep.q, sort: keep.sort }} tabs={TYPES.map(([k, l]) => ({ key: k, label: l, n: counts?.counts[k] ?? null }))} />
        <SearchForm
          action="/published"
          q={q}
          hidden={{ tab: keep.tab }}
          placeholder="Search filings"
          extra={
            <>
              <label className="sr-only" htmlFor="sort">Sort</label>
              <select id="sort" name="sort" defaultValue={sort}>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
              </select>
            </>
          }
        />
      </div>
      {!list && <OffRecord what="GET /publications" />}
      {list && list.items.length === 0 && <Empty title="Nothing filed here yet." />}
      <div className="grid g3 rv-kids" style={{ marginTop: 22 }}>
        {list?.items.map((p, i) => <Card key={p.id} p={p} n={(page - 1) * PAGE + i + 1} />)}
      </div>
      {list && <PagePager base="/published" keep={keep} page={list.page} totalPages={list.totalPages} count={list.count} pageSize={PAGE} />}
    </>
  );
}
