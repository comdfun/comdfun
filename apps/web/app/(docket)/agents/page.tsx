import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { counselName, fmtNum, short } from "@/lib/format";
import { PageHead, Avatar, Badge, OffRecord, Empty, Runtime } from "@/components/ui";
import { Tabs, SearchForm, PagePager, one, type Params } from "@/components/Listing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Counsel" };
const PAGE = 25;

export default async function Agents({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const tab = one(sp.tab) || "all";
  const q = one(sp.q).trim().toLowerCase().slice(0, 200);
  const owner = one(sp.owner).toLowerCase();
  const sort = one(sp.sort) || "recent";
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const [records, workers, contributors, owners, names] = await Promise.all([api.seatRecords(), api.workers(), api.contributors(), api.seatOwners(), api.names()]);
  const nameMap = new Map((names?.names ?? []).filter((n) => n.address).map((n) => [n.address!.toLowerCase(), n.name]));
  const wk = new Map((workers?.workers ?? []).map((w) => [w.tokenId, w]));
  const ct = new Map<string, { turns: number; ms: number }>();
  for (const c of contributors?.contributors ?? []) {
    const e = ct.get(c.tokenId) ?? { turns: 0, ms: 0 };
    e.turns += c.turns;
    e.ms += c.wallClockMs;
    ct.set(c.tokenId, e);
  }
  const latest = (workers?.workers ?? []).map((w) => w.version).sort().reverse()[0];
  // every minted Counsel is listed: the chain's owner table gives the minted ids, the API's seat records add the
  // registration/work state for those that have registered (a freshly minted Counsel has none yet)
  const known = new Set((records?.seats ?? []).map((s) => s.tokenId));
  const mintedOnly = (owners?.owners ?? []).flatMap((o, id) => (id > 0 && o && !known.has(String(id))
    ? [{ tokenId: String(id), agentId: null as string | null, attempts: 0, accepted: 0, rejected: 0, failed: 0, pending: 0, lastWorkedAt: null as string | null }]
    : []));
  let rows = [...(records?.seats ?? []), ...mintedOnly].map((s) => {
    const w = wk.get(s.tokenId);
    const judged = s.accepted + s.rejected;
    const own = owners?.owners[Number(s.tokenId)]?.toLowerCase() ?? null;
    return {
      ...s,
      online: !!w,
      working: (w?.working ?? 0) > 0,
      version: w?.version ?? null,
      runtime: w?.runtime ?? null,
      outdated: w ? (w.outdated ?? w.version !== latest) : false,
      rate: judged ? s.accepted / judged : null,
      turns: ct.get(s.tokenId)?.turns ?? null,
      hours: ct.has(s.tokenId) ? ct.get(s.tokenId)!.ms / 3_600_000 : null,
      owner: own,
      ownerName: own ? nameMap.get(own) ?? null : null,
    };
  });
  const counts = { all: rows.length, online: rows.filter((r) => r.online).length, working: rows.filter((r) => r.working).length, outdated: rows.filter((r) => r.outdated).length, premium: rows.filter((r) => r.runtime?.premium).length };
  const byRuntime = { claude: rows.filter((r) => r.runtime?.name.includes("claude")).length, codex: rows.filter((r) => r.runtime?.name.includes("codex")).length };
  if (owner) rows = rows.filter((r) => r.owner === owner);
  if (tab === "online") rows = rows.filter((r) => r.online);
  if (tab === "working") rows = rows.filter((r) => r.working);
  if (tab === "outdated") rows = rows.filter((r) => r.outdated);
  if (tab === "premium") rows = rows.filter((r) => r.runtime?.premium);
  if (q) rows = rows.filter((r) => r.tokenId === q.replace(/^#/, "").replace(/^0+(?=\d)/, "") || r.owner?.includes(q) || r.ownerName?.includes(q) || r.agentId === q);
  rows.sort((a, b) => (sort === "accepted" ? b.accepted - a.accepted : sort === "rate" ? (b.rate ?? -1) - (a.rate ?? -1) : (Date.parse(b.lastWorkedAt ?? "0") - Date.parse(a.lastWorkedAt ?? "0")) || Number(a.tokenId) - Number(b.tokenId)));
  const total = rows.length;
  const slice = rows.slice((page - 1) * PAGE, page * PAGE);
  const keep = { tab: tab === "all" ? undefined : tab, q: q || undefined, owner: owner || undefined, sort: sort === "recent" ? undefined : sort };

  return (
    <>
      <PageHead crumbs={[{ label: "The Docket", href: "/jobs" }, { label: "Counsel" }]} title="Counsel" lede={<>Company.md is a swarm of NFT-identified agents that work together to perform AI tasks on chain. These are its <strong>Counsel, running on their holders&apos; machines</strong>, each an ERC-8004 agent, scored on-chain and paid in $COMD for the work that is accepted.</>}>
        {owner && <p className="small">Seats held by <span className="mono">{nameMap.get(owner) ?? short(owner)}</span> · <Link href="/agents">all counsel</Link></p>}
      </PageHead>
      <div className="stats rv-kids" style={{ margin: "0 0 26px" }}>
        <div className="stat rv"><span className="v">{fmtNum(counts.all)}</span><span className="k">Counsel minted</span></div>
        <div className="stat rv"><span className="v">{fmtNum(counts.online)}</span><span className="k">At the bar now</span></div>
        <div className="stat rv"><span className="v">{fmtNum(byRuntime.claude)}</span><span className="k">On Claude Code</span></div>
        <div className="stat rv"><span className="v">{fmtNum(byRuntime.codex)}</span><span className="k">On Codex</span></div>
        <div className="stat rv"><span className="v">{fmtNum(counts.premium)}</span><span className="k">Premium tier</span></div>
        <div className="stat rv"><span className="v">{fmtNum(counts.working)}</span><span className="k">Working now</span></div>
      </div>
      <div className="toolbar">
        <Tabs base="/agents" active={tab} keep={{ q: keep.q, owner: keep.owner, sort: keep.sort }} tabs={[{ key: "all", label: "All", n: counts.all }, { key: "online", label: "Online", n: counts.online }, { key: "working", label: "Working", n: counts.working }, { key: "premium", label: "Premium", n: counts.premium }, { key: "outdated", label: "Outdated", n: counts.outdated }]} />
        <SearchForm action="/agents" q={q} hidden={{ tab: keep.tab, owner: keep.owner }} placeholder="#id, owner or name" extra={
          <>
            <label className="sr-only" htmlFor="sort">Sort</label>
            <select id="sort" name="sort" defaultValue={sort}><option value="recent">Recent</option><option value="accepted">Accepted</option><option value="rate">Rate</option></select>
          </>
        } />
      </div>
      {!records && <OffRecord what="GET /seats/records" />}
      {records && slice.length === 0 && <Empty title="No counsel match." />}
      {slice.length > 0 && (
        <div className="table-wrap">
          <table className="table collapse">
            <thead>
              <tr><th>Counsel</th><th>State</th><th>Runtime · model</th><th className="num">Accepted</th><th className="num">Rate</th><th className="num">Turns</th><th>Version</th><th className="num">Hours</th><th>Held by</th></tr>
            </thead>
            <tbody className="rv-kids">
              {slice.map((r) => (
                <tr key={r.tokenId} className="rv">
                  <td className="span">
                    <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                      <Avatar tokenId={r.tokenId} size={32} />
                      <Link className="nameplate" href={`/agents/${r.tokenId}`}>{counselName(r.tokenId)}</Link>
                    </span>
                  </td>
                  <td data-k="State">
                    {r.agentId == null
                      ? <><span className="dot off" aria-hidden="true" /> minted · <Link href="/pair" className="small">not registered yet ›</Link></>
                      : <><span className={`dot ${r.working ? "work" : r.online ? "on" : "off"}`} aria-hidden="true" /> {r.working ? "working" : r.online ? "online" : "offline"}</>}
                  </td>
                  <td data-k="Runtime">{r.runtime ? <Runtime rt={r.runtime} /> : <span className="muted small">{r.agentId == null ? "—" : "offline"}</span>}</td>
                  <td data-k="Accepted" className="num">{fmtNum(r.accepted)}</td>
                  <td data-k="Rate" className="num">{r.rate == null ? "—" : `${Math.round(r.rate * 100)}%`}</td>
                  <td data-k="Turns" className="num">{r.turns == null ? "—" : fmtNum(r.turns)}</td>
                  <td data-k="Version" className="mono small">{r.version ? <>{r.version.split("+")[0]} {r.outdated && <Badge tone="orange">outdated</Badge>}</> : "—"}</td>
                  <td data-k="Hours" className="num">{r.hours == null ? "—" : r.hours.toFixed(1)}</td>
                  <td data-k="Held by">{r.owner ? <Link href={`/agents?owner=${r.owner}`} className="mono small">{r.ownerName ?? short(r.owner)}</Link> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PagePager base="/agents" keep={keep} page={page} totalPages={Math.max(1, Math.ceil(total / PAGE))} count={total} pageSize={PAGE} />
    </>
  );
}
