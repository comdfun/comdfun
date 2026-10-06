import Link from "next/link";
import type { Metadata } from "next";
import { api, mapLimit } from "@/lib/api";
import { JOB_TABS, jobStage } from "@/lib/stage";
import { ago, caption, docketNo } from "@/lib/format";
import { PageHead, Avatars, Badge, OffRecord, Empty } from "@/components/ui";
import { Tabs, SearchForm, CursorPager, one, many, type Params } from "@/components/Listing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Matters" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const tabKey = one(sp.tab) || "all";
  const tab = JOB_TABS.find((t) => t.key === tabKey) ?? JOB_TABS[0];
  const q = one(sp.q).slice(0, 200);
  const stack = many(sp.b);
  const before = stack[stack.length - 1];

  const [list, swarm] = await Promise.all([
    api.jobs({ q, before, limit: 25, state: tab.states.join(",") || undefined }),
    api.swarm(),
  ]);
  const rows = (list?.jobs ?? []).filter((j) => !tab.states.length || tab.states.includes(j.state));
  // enrich with nodes (stage + counsel avatars); details are cached 10 s
  const details = await mapLimit(rows, 8, (j) => api.job(j.id));

  const js = swarm?.counts.jobStates ?? {};
  const sum = (states: string[]) => states.reduce((a, s) => a + (js[s] ?? 0), 0);
  const counts = swarm && !q ? { all: swarm.counts.jobs, running: sum(JOB_TABS[1].states), incomplete: sum(JOB_TABS[2].states), completed: sum(JOB_TABS[3].states) } : null;
  const total = counts ? counts[tab.key as keyof typeof counts] : null;
  const nextCursor = list && list.count >= 25 ? list.jobs[list.jobs.length - 1]?.createdAt : null;

  return (
    <>
      <PageHead crumbs={[{ label: "The Docket", href: "/jobs" }, { label: "Matters" }]} title="Matters" lede={<>What the firm is working on: contracts, sites, research and media, <strong>one objective per matter</strong>, newest first.</>} />
      <div className="toolbar">
        <Tabs base="/jobs" active={tab.key} keep={{ q: q || undefined }} tabs={JOB_TABS.map((t) => ({ key: t.key, label: t.label, n: counts ? counts[t.key as keyof typeof counts] : null }))} />
        <SearchForm action="/jobs" q={q} hidden={{ tab: tab.key === "all" ? undefined : tab.key }} placeholder="Search matters" />
      </div>
      {!list && <OffRecord what="GET /jobs" />}
      {list && rows.length === 0 && <Empty title="No matters on the docket.">{q ? `Nothing matches “${q}”.` : "Retain the firm to open the first."}</Empty>}
      <ul className="rows rv-kids">
        {rows.map((j, i) => {
          const d = details[i];
          const stage = jobStage({ ...j, nodes: d?.nodes });
          const seats = (d?.nodes ?? []).map((n) => n.seat?.tokenId).filter(Boolean) as string[];
          const kind = (j.template ?? "").replace(/^skill:/, "").replace(/^launch:/, "launch · ").replace(/_/g, " ");
          return (
            <li key={j.id} className="rv">
              <Link className="rowlink" href={`/jobs/${j.id}`}>
                <div className="meta">
                  <span className="docket">{docketNo("Matter", j.id, j.createdAt)}</span>
                  <span>opened {ago(j.createdAt)}</span>
                </div>
                <div>
                  <div className="title">
                    <span className="caption-in-re"><span className="inre">In re:</span>{caption(j.objective, 180)}</span>
                  </div>
                  <div className="sub">
                    {kind && <span className="tag">{kind}</span>}
                    {d?.site && <> · site {d.site.label}</>}
                    {d?.launch?.requested && <> · incorporation {d.launch.status ?? ""}</>}
                  </div>
                </div>
                <div className="side">
                  <Badge tone={stage.tone} title={stage.title} live={stage.live}>{stage.label}</Badge>
                  <Avatars ids={seats} max={5} />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      <CursorPager base="/jobs" keep={{ q: q || undefined, tab: tab.key === "all" ? undefined : tab.key }} stack={stack} nextCursor={nextCursor} shown={rows.length} total={total} />
    </>
  );
}
