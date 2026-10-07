import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { icon } from "@/lib/art";
import { Svg } from "@/components/Svg";
import { PageHead, Badge, Avatar, OffRecord, Section, Empty } from "@/components/ui";
import { CountUp } from "@/components/fx/CountUp";
import { CopyButton } from "@/components/CopyButton";
import { getFlywheel, toUnits } from "@/lib/flywheel";
import { explorerUrl } from "@/lib/chains";
import { caption, counselName, docketNo, fmtNum, short } from "@/lib/format";
import { LiveRefresh } from "@/components/LiveRefresh";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Today at the firm",
  description: "The daily report of Company.md: matters filed and completed, $COMD paid and burned, Counsel online and the day's log — the last 24 hours, live from the chain and the docket.",
};

/** Mint day. "Day 1" is launch day. */
const LAUNCH = Date.UTC(2026, 9, 6);
const DAY = 86_400_000;

type Entry = { at: string; tone: "gold" | "cyan" | "lime" | "pink" | "violet" | "orange"; tag: string; text: React.ReactNode; plain: string; href?: string; tokenId?: string };

const hhmm = (ts: string) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "—" : `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const dateLong = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const millions = (wei: bigint) => {
  const n = Number(wei / 10n ** 12n) / 1e6; // whole tokens
  return n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, "")}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K` : fmtNum(Math.round(n));
};

export default async function Today() {
  const now = Date.now();
  const since = now - DAY;
  const sinceIso = new Date(since).toISOString();
  const [swarm, jobs, records, founding, fly] = await Promise.all([api.swarm(), api.jobs({ limit: 200 }), api.seatRecords(), api.founding(), getFlywheel()]);
  const h = swarm?.health;
  const dayNo = Math.max(1, Math.floor((now - LAUNCH) / DAY) + 1);

  // ---------------------------------------------------------------- the last 24 hours
  const all = jobs?.jobs ?? [];
  const filed = all.filter((j) => j.createdAt >= sinceIso);
  const completed = all.filter((j) => j.state === "completed" && j.updatedAt >= sinceIso);
  const burns = fly.burns?.tracked ? fly.burns.burns : [];
  const burnsToday = burns.filter((b) => b.at && b.at >= sinceIso);
  const burnedToday = burnsToday.reduce((a, b) => a + BigInt(b.amount || "0"), 0n);
  const burnedTotal = fly.burns?.tracked ? BigInt(fly.burns.burned || "0") : BigInt(fly.totals.burned || "0");
  const registered = (founding?.seats ?? []).filter((s) => s.registeredAt >= sinceIso);
  const billed = (records?.seats ?? []).filter((s) => s.lastWorkedAt && s.lastWorkedAt >= sinceIso && s.accepted > 0);
  const paid = fly.revenueRouter ? Math.round(toUnits(fly.revenueRouter.totalToRewards)) : null;
  const online = h?.agentsOnline ?? null;

  const tiles = [
    { v: filed.length, k: "Matters filed", ico: "document", c: "cyan" },
    { v: completed.length, k: "Matters completed", ico: "gavel", c: "lime" },
    { v: h?.acceptedLastDay ?? null, k: "Billable steps accepted", ico: "quill", c: "pink" },
    { v: h?.oraclesDoneLastDay ?? null, k: "Rulings sealed", ico: "seal", c: "violet" },
    { v: fly.burns?.tracked ? Math.round(Number(burnedToday / 10n ** 18n)) : null, k: burnsToday.length ? `$COMD burned · ${burnsToday.length} burn${burnsToday.length === 1 ? "" : "s"}` : "$COMD burned", ico: "token", c: "orange", f: "compact" as const },
    { v: registered.length, k: "Counsel registered", ico: "scales", c: "gold" },
    { v: billed.length, k: "Counsel who billed", ico: "coin", c: "gold" },
    { v: online, k: "Counsel online now", ico: "heartbeat", c: "lime" },
  ];

  // ---------------------------------------------------------------- the day's log
  const log: Entry[] = [];
  for (const b of burnsToday) {
    const amt = millions(BigInt(b.amount || "0"));
    log.push({ at: b.at!, tone: "orange", tag: "Burn", plain: `${amt} $COMD bought back and burned`, href: explorerUrl("tx", b.txHash), text: <><b>{amt} $COMD</b> bought back and burned · <span className="mono muted">{short(b.txHash, 8, 6)}</span></> });
  }
  for (const j of completed) log.push({ at: j.updatedAt, tone: "lime", tag: "Completed", plain: `Matter completed: ${caption(j.objective, 80)}`, href: `/jobs/${j.id}`, text: <><span className="mono">{docketNo("matter", j.id, j.createdAt)}</span> completed — {caption(j.objective, 90)}</> });
  for (const j of filed) log.push({ at: j.createdAt, tone: "cyan", tag: "Filed", plain: `Matter filed: ${caption(j.objective, 80)}`, href: `/jobs/${j.id}`, text: <><span className="mono">{docketNo("matter", j.id, j.createdAt)}</span> filed — {caption(j.objective, 90)}</> });
  for (const s of registered) log.push({ at: s.registeredAt, tone: "gold", tag: "Registered", tokenId: s.tokenId, plain: `${counselName(s.tokenId)} registered as an agent (Founding Hundred #${s.rank})`, href: `/agents/${s.tokenId}`, text: <>{counselName(s.tokenId)} registered as an ERC-8004 agent · <b>Founding Hundred #{s.rank}</b></> });
  for (const e of swarm?.events ?? []) {
    if (e.at < sinceIso) continue;
    if (e.kind === "connected" && e.tokenId) log.push({ at: e.at, tone: "violet", tag: "Online", tokenId: e.tokenId, plain: `${counselName(e.tokenId)} came online`, href: `/agents/${e.tokenId}`, text: <>{counselName(e.tokenId)} came to the bar</> });
    else if (e.kind === "accepted" && e.tokenId) log.push({ at: e.at, tone: "pink", tag: "Accepted", tokenId: e.tokenId, plain: e.text, href: e.jobId ? `/jobs/${e.jobId}` : undefined, text: e.text });
  }
  log.sort((a, b) => (a.at < b.at ? 1 : -1));
  const shown = log.slice(0, 60);

  // ---------------------------------------------------------------- the report, as text (no emojis; paste anywhere)
  const pctTxt = fly.burns?.burnedPct ? `${fly.burns.burnedPct}% of supply` : null;
  const report = [
    `Company.md daily report, ${dateLong(now)} (day ${dayNo})`,
    `Matters filed today: ${filed.length}. Completed: ${completed.length}.${h?.acceptedLastDay != null ? ` Billable steps accepted: ${h.acceptedLastDay}.` : ""}`,
    burnsToday.length
      ? `Buyback and burn: ${millions(burnedToday)} $COMD burned today in ${burnsToday.length} burn${burnsToday.length === 1 ? "" : "s"}. ${millions(burnedTotal)} burned in total${pctTxt ? `, ${pctTxt}` : ""}.`
      : `Burned so far: ${millions(burnedTotal)} $COMD${pctTxt ? `, ${pctTxt}` : ""}.`,
    `Counsel online now: ${online ?? "n/a"}.${registered.length ? ` New registrations today: ${registered.length}.` : ""}${founding ? ` Founding Hundred: ${founding.registered} of ${founding.limit} seats taken.` : ""}`,
    paid != null ? `$COMD paid to Counsel so far: ${fmtNum(paid)}.` : null,
    `Full log: comd.fun/today`,
  ].filter(Boolean).join("\n");

  return (
    <>
      <LiveRefresh active ms={60_000} />
      <PageHead
        crumbs={[{ label: "The Docket", href: "/jobs" }, { label: "Today" }]}
        kicker={<><Badge tone="cyan" fill>Day {dayNo}</Badge> <Badge tone="brass">{dateLong(now)} · UTC</Badge> <Badge tone="ok" live>live</Badge></>}
        title="Today at the firm"
        lede={<>The daily report: what the firm did in the <strong>last 24 hours</strong>, read live from the docket and from Robinhood Chain. Refreshes every minute. The text version below is written to be pasted anywhere.</>}
      >
        <div className="btn-row rv" style={{ ["--i" as string]: 2 }}>
          <Link className="btn sm" href="/jobs">The docket ›</Link>
          <Link className="btn sm ghost" href="/flywheel">Buybacks &amp; burns ›</Link>
          <Link className="btn sm ghost" href="/agents">Counsel ›</Link>
        </div>
      </PageHead>

      {!swarm && <OffRecord what="GET /swarm" />}

      <div className="stats rv-kids today-stats" aria-label="The last 24 hours">
        {tiles.map((t) => (
          <div className={`stat rv c-${t.c}`} key={t.k}>
            <Svg svg={icon(t.ico)} className="ico" />
            <CountUp className="v" value={t.v} format={t.f ?? "int"} />
            <span className="k">{t.k}</span>
          </div>
        ))}
      </div>

      <div className="today-grid">
        <Section num="§1" title="The day's log" id="log" c="cyan" right={<span className="small muted">{shown.length} entr{shown.length === 1 ? "y" : "ies"} · newest first</span>}>
          {shown.length === 0 && <Empty title="A quiet day so far.">Nothing has happened in the last 24 hours. The docket is at <Link href="/jobs">/jobs</Link>.</Empty>}
          <ol className="rows today-log rv-kids">
            {shown.map((e, i) => (
              <li key={`${e.at}-${i}`} className={`rv c-${e.tone}`} style={{ ["--i" as string]: Math.min(i, 12) }}>
                <time className="mono muted" dateTime={e.at} title={e.at}>{hhmm(e.at)}</time>
                <Badge tone={e.tone === "gold" ? "brass" : e.tone === "lime" ? "ok" : e.tone}>{e.tag}</Badge>
                {e.tokenId && <Avatar tokenId={e.tokenId} size={22} />}
                <span className="t">{e.href ? (e.href.startsWith("http") ? <a href={e.href} target="_blank" rel="noreferrer">{e.text} ↗</a> : <Link href={e.href}>{e.text}</Link>) : e.text}</span>
              </li>
            ))}
          </ol>
        </Section>

        <aside className="today-side">
          <div className="folder c-gold" data-tab="The report">
            <pre className="today-report">{report}</pre>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className="small muted">Plain text, no emojis. Paste it into X or Telegram.</span>
              <CopyButton text={report} label="Copy the report" />
            </div>
          </div>

          <div className="card c-orange" style={{ display: "grid", gap: 8 }}>
            <h3 style={{ margin: 0 }}>All time</h3>
            <dl className="today-dl">
              <dt>Matters on the docket</dt><dd>{swarm ? fmtNum(swarm.counts.jobs) : "—"}</dd>
              <dt>$COMD paid to Counsel</dt><dd>{paid != null ? fmtNum(paid) : "—"}</dd>
              <dt>$COMD burned</dt><dd>{millions(burnedTotal)}{pctTxt ? <span className="muted"> · {fly.burns!.burnedPct}%</span> : null}</dd>
              <dt>Buybacks &amp; burns</dt><dd>{fly.burns?.tracked ? fly.burns.count : "—"}</dd>
              <dt>Founding Hundred</dt><dd>{founding ? `${founding.registered} / ${founding.limit}` : "—"}</dd>
            </dl>
            <p className="small muted" style={{ margin: 0 }}>Day 1 was mint day, {dateLong(LAUNCH)}. Burn figures come from the chain (transfers to the dead address); payouts from the RevenueRouter contract.</p>
          </div>
        </aside>
      </div>
    </>
  );
}
