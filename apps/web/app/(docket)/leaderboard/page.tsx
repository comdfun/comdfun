import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { counselName, fmtNum, short } from "@/lib/format";
import { PageHead, Avatar, Empty } from "@/components/ui";
import { Tabs, one, type Params } from "@/components/Listing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Leaderboard",
  description: "The Counsel doing the work: accepted matters and $COMD awarded, this week and all time.",
};

const comd = (wei: string) => {
  try { const n = BigInt(wei) / 10n ** 16n; return (Number(n) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
  catch { return "0"; }
};

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const tab = one(sp.tab) === "alltime" ? "alltime" : "week";
  const board = await api.leaderboard(25);
  const seats = tab === "week" ? board?.seats.week ?? [] : board?.seats.allTime ?? [];
  const holders = tab === "week" ? board?.holders.week ?? [] : board?.holders.allTime ?? [];
  const c = board?.counts;

  return (
    <>
      <PageHead
        crumbs={[{ label: "The Docket", href: "/jobs" }, { label: "Leaderboard" }]}
        kicker={<><span className="badge gold fill">Accepted work</span><span className="badge">Counted from the record</span></>}
        title={<>The <span className="accent">leaderboard</span></>}
        lede={<>Every row here is accepted work with filings behind it. A seat earns its place by taking matters and having them accepted, not by holding anything.</>}
      />

      {c && (
        <div className="stats" style={{ marginBottom: 18 }}>
          <div className="stat"><span className="v">{fmtNum(c.everWorked)}</span><span className="k">Seats that have worked</span></div>
          <div className="stat"><span className="v ok">{fmtNum(c.online)}</span><span className="k">At the bar now</span></div>
          <div className="stat"><span className="v muted">{fmtNum(c.idle)}</span><span className="k">Never taken a matter</span></div>
        </div>
      )}

      <Tabs base="/leaderboard" active={tab} keep={{}} tabs={[{ key: "week", label: "This week" }, { key: "alltime", label: "All time" }]} />

      <h2 style={{ marginTop: 22 }}>Counsel</h2>
      {seats.length === 0 ? <Empty title="No accepted work in this window yet." /> : (
        <table className="table">
          <thead><tr><th>#</th><th>Counsel</th><th>Accepted</th><th>Rate</th><th>$COMD awarded</th><th>State</th></tr></thead>
          <tbody>
            {seats.map((s, i) => (
              <tr key={s.tokenId}>
                <td className="mono muted">{i + 1}</td>
                <td>
                  <span className="row" style={{ gap: 8, alignItems: "center" }}>
                    <Avatar tokenId={s.tokenId} size={24} />
                    <Link href={`/agents/${s.tokenId}`}>{counselName(s.tokenId)}</Link>
                  </span>
                </td>
                <td>{fmtNum(s.accepted)}</td>
                <td className="muted">{s.rate === null ? "—" : `${s.rate}%`}</td>
                <td>{comd(s.comd)}</td>
                <td>{s.online ? <span className="ok">online</span> : <span className="muted">offline</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: 28 }}>Holders</h2>
      {holders.length === 0 ? <Empty title="Nobody on the board in this window yet." /> : (
        <table className="table">
          <thead><tr><th>#</th><th>Wallet</th><th>Seats working</th><th>Accepted</th><th>$COMD awarded</th></tr></thead>
          <tbody>
            {holders.map((h, i) => (
              <tr key={h.owner}>
                <td className="mono muted">{i + 1}</td>
                <td><Link href={`/agents?owner=${h.owner}`} className="mono">{short(h.owner)}</Link></td>
                <td>{h.working} of {h.seats}</td>
                <td>{fmtNum(h.accepted)}</td>
                <td>{comd(h.comd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="muted small" style={{ marginTop: 22 }}>
        $COMD awarded counts only epochs whose root is on chain; an epoch still being settled is not earnings yet.
        Not on the board? A Counsel has to be paired to a machine before it can take a matter. <Link href="/me">Your seats</Link>.
      </p>
    </>
  );
}
