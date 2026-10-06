import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { scheduleStage, cadenceText } from "@/lib/stage";
import { ago, caption, docketNo, fmtNum } from "@/lib/format";
import { PageHead, Badge, OffRecord, Empty } from "@/components/ui";
import { CursorPager, many, one, type Params } from "@/components/Listing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Retainers" };

export default async function Heartbeats({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const owner = one(sp.owner);
  const stack = many(sp.b);
  const [list, names] = await Promise.all([api.schedules({ limit: 25, before: stack[stack.length - 1], owner: /^0x[0-9a-fA-F]{40}$/.test(owner) ? owner.toLowerCase() : undefined }), api.names()]);
  const nameMap = new Map((names?.names ?? []).filter((n) => n.address).map((n) => [n.address!.toLowerCase(), n.name]));
  const rows = list?.schedules ?? [];
  return (
    <>
      <PageHead
        crumbs={[{ label: "The Docket", href: "/jobs" }, { label: "Retainers" }]}
        title="Retainers"
        lede={<>Rulings and matters the firm opens <strong>on a schedule</strong>, run by run, until the runs bought are used. Only opened runs spend one; skipped and failed runs cost nothing; unused runs are not refunded.</>}
      >
        <div className="btn-row"><Link className="btn sm" href="/launch?mode=retainer">Set up a retainer</Link>{owner && <Link className="btn sm ghost" href="/heartbeats">All owners</Link>}</div>
      </PageHead>
      {!list && <OffRecord what="GET /schedules" />}
      {list && rows.length === 0 && <Empty title="No retainers." />}
      <ul className="rows rv-kids" style={{ borderTop: "2px solid var(--rule)" }}>
        {rows.map((s) => {
          const st = scheduleStage(s.status);
          return (
            <li key={s.id} className="rv">
              <Link className="rowlink" href={`/heartbeats/${s.id}`}>
                <div className="meta">
                  <span className="docket">{docketNo("Retainer", s.id, s.createdAt)}</span>
                  <span>{s.action === "oracle.request" ? "ruling" : "matter"}</span>
                </div>
                <div>
                  <div className="title">{s.label ?? caption(String(s.input.question ?? s.input.objective ?? s.id), 120)}</div>
                  <div className="sub">
                    {cadenceText(s.cadence)} · {fmtNum(s.runs.remaining)} run{s.runs.remaining === 1 ? "" : "s"} left of {fmtNum(s.runs.total)}
                    {s.nextRunAt && s.status === "active" ? ` · next ${ago(s.nextRunAt)}` : ""}
                    {s.continue ? " · continues" : ""}
                  </div>
                </div>
                <div className="side">
                  <Badge tone={st.tone} title={st.title} live={st.live}>{st.label}</Badge>
                  <span className="small muted">{nameMap.get(s.owner.toLowerCase()) ?? `${s.owner.slice(0, 6)}…${s.owner.slice(-4)}`}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      <CursorPager base="/heartbeats" keep={{ owner: owner || undefined }} stack={stack} nextCursor={list && list.count >= 25 ? rows[rows.length - 1]?.createdAt : null} shown={rows.length} />
      <p className="small muted">Owner filter: <span className="mono">/heartbeats?owner=0x…</span>. Pausing and cancelling stay with the firm; anyone may top up any retainer.</p>
    </>
  );
}
