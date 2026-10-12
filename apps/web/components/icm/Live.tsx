"use client";
// The desk, in the open: what it has served and how much $COMD it has taken out of supply.
//
// Straight from the ledger's public stats (GET /icm/v1/stats): settled calls only, paid deposits only, and no
// dollar figure of the house's. Refreshed every thirty seconds, which is also how long the API caches it.
import { useEffect, useState } from "react";

export type Stats = {
  at: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  payers: number;
  keys: number;
  medianLatencyMs: number | null;
  models: { model: string; calls: number; share: number }[];
  days: { date: string; calls: number }[];
  token: { symbol: string; sink: string; paid: string; burned: string };
};

const short = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(0)}k` : n.toLocaleString();
const secs = (ms: number | null) => (ms === null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });

export function Live() {
  const [s, setS] = useState<Stats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/icm/v1/stats", { cache: "no-store", signal: AbortSignal.timeout(10_000) })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j: Stats) => { if (live) { setS(j); setFailed(false); } })
        .catch(() => { if (live) setFailed(true); });
    load();
    const t = setInterval(load, 30_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const peak = Math.max(1, ...(s?.days.map((d) => d.calls) ?? [1]));
  const top = Math.max(1, s?.models[0]?.calls ?? 1);
  const burned = s ? Number(s.token.burned) : 0;

  return (
    <section className="icm-live">
      <div className="icm-cat-say">
        <h2>The desk, in the open.</h2>
        <p>Every figure comes straight from the ledger: settled calls only, and every $COMD paid in. Refreshed every 30 seconds.</p>
      </div>

      <div className="dash live">
        <div className="dash-bar">
          <span className={s ? "dash-dot live-dot" : "dash-dot"} aria-hidden="true" />
          <span className="dash-where">api.comd.fun/icm/v1/stats</span>
          <span className="live-at">{failed && !s ? "not reachable right now" : s ? `live · ${time(s.at)}` : "loading…"}</span>
        </div>

        <div className="dash-tiles">
          <div className="dash-tile"><span>Calls served</span><b>{s ? short(s.calls) : "—"}</b></div>
          <div className="dash-tile"><span>Tokens processed</span><b>{s ? short(s.tokensIn + s.tokensOut) : "—"}</b></div>
          <div className="dash-tile live-burn"><span>${s?.token.symbol ?? "COMD"} burned</span><b>{s ? short(Math.floor(burned)) : "—"}</b></div>
          <div className="dash-tile"><span>Median response</span><b>{s ? secs(s.medianLatencyMs) : "—"}</b></div>
        </div>

        <div className="live-panels">
          <div className="dash-panel">
            <div className="dash-ph"><span>Calls per day</span><span className="muted small">last 14 days</span></div>
            <div className="dash-chart live-chart" role="img" aria-label="Calls served per day over the last fourteen days">
              {(s?.days ?? Array.from({ length: 14 }, (_, i) => ({ date: String(i), calls: 0 }))).map((d, i) => (
                <i key={d.date} title={s ? `${day(d.date)}: ${d.calls.toLocaleString()} calls` : undefined}
                  style={{ height: `${Math.max(3, Math.round((d.calls / peak) * 100))}%`, ["--i" as string]: i }} />
              ))}
            </div>
            {s && <div className="live-axis"><span>{day(s.days[0].date)}</span><span>today</span></div>}
          </div>

          <div className="dash-panel">
            <div className="dash-ph"><span>Most used</span><span className="muted small">share of calls</span></div>
            {s && s.models.length > 0 ? (
              <ul className="dash-models live-models">
                {s.models.slice(0, 6).map((m) => (
                  <li key={m.model}>
                    <span className="dash-m">{m.model}</span>
                    <span className="dash-track"><i style={{ width: `${Math.max(4, Math.round((m.calls / top) * 100))}%` }} /></span>
                    <span className="dash-amt">{(m.share * 100).toFixed(m.share < 0.1 ? 1 : 0)}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>{s ? "No calls settled yet. The first one shows up here." : " "}</p>
            )}
          </div>
        </div>

        {s && (
          <div className="live-foot">
            <span><b>{s.payers.toLocaleString()}</b> wallets have paid in</span>
            <span><b>{s.keys.toLocaleString()}</b> keys issued</span>
            <span className="live-foot-burn">
              {s.token.sink === "burn" ? <>All <b>{short(Math.floor(Number(s.token.paid)))}</b> ${s.token.symbol} paid in is gone for good</> : <><b>{short(Math.floor(Number(s.token.paid)))}</b> ${s.token.symbol} paid in</>}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
