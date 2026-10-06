import Link from "next/link";
import type { Metadata } from "next";
import { api, mapLimit } from "@/lib/api";
import { ORACLE_TABS, oracleStage } from "@/lib/stage";
import { ago, caption, docketNo } from "@/lib/format";
import { chainName } from "@/lib/chains";
import { PageHead, Badge, Seal, OffRecord, Empty } from "@/components/ui";
import { Tabs, SearchForm, CursorPager, one, many, type Params } from "@/components/Listing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rulings" };

export default async function OraclePage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const tab = ORACLE_TABS.find((t) => t.key === one(sp.tab)) ?? ORACLE_TABS[0];
  const q = one(sp.q).slice(0, 200);
  const stack = many(sp.b);
  const before = stack[stack.length - 1];
  const [list, counts] = await Promise.all([api.oracleRequests({ q, before, limit: 25, status: tab.statuses.join(",") || undefined }), api.oracleCounts()]);
  const rows = (list?.requests ?? []).filter((r) => !tab.statuses.length || tab.statuses.includes(r.status));
  const details = await mapLimit(rows, 8, (r) => (r.status === "attested" || r.status === "disagreed" ? api.oracle(r.id) : Promise.resolve(null)));
  const by = counts?.byStatus ?? {};
  const n = (s: string[]) => s.reduce((a, k) => a + (by[k] ?? 0), 0);
  const tabCount = (k: string) => (!counts || q ? null : k === "all" ? counts.total : n(ORACLE_TABS.find((t) => t.key === k)!.statuses));
  const nextCursor = list && list.count >= 25 ? list.requests[list.requests.length - 1]?.createdAt : null;

  return (
    <>
      <PageHead
        crumbs={[{ label: "The Docket", href: "/jobs" }, { label: "Rulings" }]}
        title="Rulings"
        lede={<>Questions put to the firm about a chain or the world, <strong>answered by a panel of counsel</strong> who must all agree, then signed (EIP-712) so a contract can act on the answer.</>}
      />
      <div className="toolbar">
        <Tabs base="/oracle" active={tab.key} keep={{ q: q || undefined }} tabs={ORACLE_TABS.map((t) => ({ key: t.key, label: t.label, n: tabCount(t.key) }))} />
        <SearchForm action="/oracle" q={q} hidden={{ tab: tab.key === "all" ? undefined : tab.key }} placeholder="Search questions" />
      </div>
      {!list && <OffRecord what="GET /oracle/requests" />}
      {list && rows.length === 0 && <Empty title="No rulings.">{q ? `Nothing matches “${q}”.` : "Request the first ruling."}</Empty>}
      <ul className="rows rv-kids">
        {rows.map((r, i) => {
          const st = oracleStage(r.status);
          const d = details[i];
          const answer = d?.agreement?.answer ?? d?.computed?.answer;
          return (
            <li key={r.id} className="rv">
              <Link className="rowlink" href={`/oracle/${r.id}`}>
                <div className="meta">
                  <span className="docket">{docketNo("Ruling", r.id, r.createdAt)}</span>
                  <span>{chainName(r.chainId)}</span>
                  <span>asked {ago(r.createdAt)}</span>
                </div>
                <div>
                  <div className="title">{caption(r.question, 200)}</div>
                  <div className="sub">
                    {answer ? (<>answer <span style={{ color: "var(--text)" }}>{caption(answer, 80)}</span></>) : <span>{r.answerType} · {r.panelSize ?? d?.panelSize ?? "—"} counsel</span>}
                    {d?.agreement && <> · {d.agreement.agreed}/{d.panelSize} agreed</>}
                  </div>
                </div>
                <div className="side">
                  {r.status === "attested" ? <Seal /> : <Badge tone={st.tone} title={st.title} live={st.live}>{st.label}</Badge>}
                  <span className="small muted">Details →</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      <CursorPager base="/oracle" keep={{ q: q || undefined, tab: tab.key === "all" ? undefined : tab.key }} stack={stack} nextCursor={nextCursor} shown={rows.length} total={tabCount(tab.key)} />
    </>
  );
}
