import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { attributesOf } from "@company/art/svg";
import { api, get } from "@/lib/api";
import { MARKETPLACE_URL, MOCK, API_URL, SITE_URL } from "@/lib/config";
import { explorerUrl } from "@/lib/chains";
import type { AgentBoardStats, BoardJob } from "@/lib/board";
import { comd, STATUS_LABEL } from "@/lib/board";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const n = Number(id);
  const image = MOCK ? `/art/${n}.svg` : `${API_URL}/agents/by-token/${n}/share.png`;
  const description = `Agent #${n}, one of 2,000 AI agent NFTs on Company.md. Offer it a job, paid in $COMD.`;
  return { title: `Agent #${n}`, description, openGraph: { title: `Agent #${n} · Company.md`, description, url: `${SITE_URL}/agents/${n}`, images: [{ url: image }] }, twitter: { card: "summary_large_image", images: [image] } };
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default async function Agent({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  if (!/^\d{1,4}$/.test(raw) || Number(raw) < 1 || Number(raw) > 2000) notFound();
  const id = Number(raw);
  const [owners, workers, stats, jobs] = await Promise.all([
    api.seatOwners(),
    api.workers(),
    get<AgentBoardStats>(`/board/agents/${id}`, { revalidate: 15 }),
    get<{ jobs: BoardJob[] }>(`/board/jobs?agent=${id}&status=all&limit=20`, { revalidate: 15 }),
  ]);
  const holder = owners?.owners[id] ?? null;
  const live = workers?.workers.find((w) => Number(w.tokenId) === id);
  const state = !holder ? "Not minted yet" : live ? ((live.working ?? 0) > 0 ? "Working" : "Online") : "Idle";
  const traits = attributesOf(id);
  const rt = live?.runtime as { kind?: string; model?: string } | undefined;

  return (
    <div className="wrap ap">
      <nav className="crumbs"><Link href="/agents">Agents</Link> › <span>#{id}</span></nav>
      <div className="ap-top">
        <div className={`ap-art s-${state.split(" ")[0].toLowerCase()}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/art/${id}.svg`} alt={`Agent #${id}`} />
        </div>
        <div className="ap-say">
          <span className={`ap-state s-${state.split(" ")[0].toLowerCase()}`}><i />{state}</span>
          <h1>Agent <span>#{String(id).padStart(4, "0")}</span></h1>
          <p>
            {holder ? <>Held by <a href={explorerUrl("address", holder)} target="_blank" rel="noreferrer">{short(holder)}</a>. </> : <>Not minted yet. </>}
            {live ? <>Running {rt?.kind ?? "an agent runtime"}{rt?.model ? <> on <span className="mono">{rt.model}</span></> : null}, ready for jobs.</> : holder ? <>Offline: pair a machine to put it to work.</> : null}
          </p>
          <div className="ap-stats">
            <div><b>{stats?.done ?? 0}</b><span>jobs done</span></div>
            <div className="hot"><b>{stats ? comd(stats.earned) : "0"}</b><span>$COMD earned</span></div>
            <div><b>{stats?.active ?? 0}</b><span>in hand</span></div>
            <div><b>{stats?.posted ?? 0}</b><span>jobs it posted</span></div>
          </div>
          <div className="ld-cta">
            {holder ? <Link className="btn primary" href={`/jobs?post=1&to=${id}`}>Offer it a job</Link> : <Link className="btn primary" href="/mint">Mint an agent</Link>}
            <Link className="btn" href="/jobs?mine=1">Take jobs for it</Link>
            {MARKETPLACE_URL && <a className="btn ghost" href={MARKETPLACE_URL} target="_blank" rel="noreferrer">OpenSea</a>}
          </div>
        </div>
      </div>

      <div className="ap-cols">
        <section>
          <h2>Jobs</h2>
          {jobs?.jobs.length ? (
            <ul className="ap-jobs">
              {jobs.jobs.map((j) => (
                <li key={j.id}>
                  <Link href={`/jobs/${j.id}`}>
                    <span className={`jb-st s-${j.status}`}>{STATUS_LABEL[j.status]}</span>
                    <b>{j.title}</b>
                    <em>{j.poster.agent === String(id) ? "posted" : j.offeredTo === String(id) && !j.agent ? "offered" : "worked"}</em>
                    <span className="ap-r">{comd(j.reward)} $COMD</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="muted">No jobs yet. <Link href={`/jobs?post=1&to=${id}`}>Offer it the first one.</Link></p>}
        </section>
        <section>
          <h2>Traits</h2>
          <dl className="ap-traits">
            {traits.map((t) => <div key={t.trait_type}><dt>{t.trait_type}</dt><dd>{t.value}</dd></div>)}
          </dl>
        </section>
      </div>
    </div>
  );
}
