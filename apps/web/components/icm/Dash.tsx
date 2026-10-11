"use client";
// The account, read the way anybody reads a usage dashboard: four figures, spend by day, and spend by model.
//
// Signed out it shows a sample, labelled as one in the corner and in a line under it. A dashboard of zeroes
// tells a first-time visitor nothing about what they would get; a dashboard of invented numbers presented as
// real would be a lie. A sample that says it is a sample is neither.
import { useMemo } from "react";

export type Charge = { id: string; at: string; model: string; state: string; costMicroUsd: string; tokensIn: number; tokensOut: number };

const M = 1_000_000n;
/** Micro-dollars to a short dollar string: the figure is read, not reconciled. */
const usd = (micro: bigint) => {
  const neg = micro < 0n;
  const a = neg ? -micro : micro;
  const whole = Number(a / M) + Number(a % M) / 1e6;
  return `${neg ? "-" : ""}$${whole.toLocaleString(undefined, { minimumFractionDigits: whole < 10 ? 2 : 0, maximumFractionDigits: whole < 10 ? 2 : 0 })}`;
};
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

/** A plausible fortnight, generated from a fixed seed so the sample does not change between renders. */
function sample(): { charges: Charge[]; account: { balanceMicroUsd: string; heldMicroUsd: string; spentMicroUsd: string; depositedMicroUsd: string } } {
  const models = ["anthropic/claude-opus-4.1", "openai/gpt-5", "google/gemini-2.5-pro", "deepseek/deepseek-r1", "x-ai/grok-4"];
  const out: Charge[] = [];
  let x = 20_260_411;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const now = Date.now();
  for (let d = 13; d >= 0; d--) {
    const n = 3 + Math.floor(rnd() * 7);
    for (let i = 0; i < n; i++) {
      const cost = BigInt(Math.round((0.004 + rnd() * 0.09) * 1e6));
      out.push({
        id: `s${d}-${i}`,
        at: new Date(now - d * 86_400_000 - Math.floor(rnd() * 8.64e7)).toISOString(),
        model: models[Math.floor(rnd() * models.length)],
        state: "settled",
        costMicroUsd: String(cost),
        tokensIn: 400 + Math.floor(rnd() * 9_000),
        tokensOut: 150 + Math.floor(rnd() * 3_000),
      });
    }
  }
  const spent = out.reduce((a, c) => a + BigInt(c.costMicroUsd), 0n);
  return {
    charges: out,
    account: {
      balanceMicroUsd: String(spent / 3n),
      heldMicroUsd: "41200",
      spentMicroUsd: String(spent),
      depositedMicroUsd: String(spent + spent / 3n),
    },
  };
}

export function Dash({ account, charges, isSample }: {
  account: { balanceMicroUsd: string; heldMicroUsd: string; spentMicroUsd: string; depositedMicroUsd: string };
  charges: Charge[];
  isSample?: boolean;
}) {
  const data = useMemo(() => {
    // fourteen buckets by local day, oldest first, so the bars read left to right like a calendar
    const days: { key: string; total: bigint }[] = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let d = 13; d >= 0; d--) {
      const t = new Date(today.getTime() - d * 86_400_000);
      days.push({ key: t.toDateString(), total: 0n });
    }
    const index = new Map(days.map((d, i) => [d.key, i]));
    const byModel = new Map<string, { total: bigint; calls: number }>();
    let tokens = 0;
    for (const c of charges) {
      let cost = 0n;
      try { cost = BigInt(c.costMicroUsd); } catch { /* a figure that will not parse is not a figure */ }
      const i = index.get(new Date(c.at).toDateString());
      if (i !== undefined) days[i].total += cost;
      const m = byModel.get(c.model) ?? { total: 0n, calls: 0 };
      m.total += cost; m.calls += 1;
      byModel.set(c.model, m);
      tokens += (c.tokensIn || 0) + (c.tokensOut || 0);
    }
    const peak = days.reduce((a, d) => (d.total > a ? d.total : a), 1n);
    const models = [...byModel.entries()].sort((a, b) => (b[1].total > a[1].total ? 1 : -1)).slice(0, 5);
    const top = models.length ? models[0][1].total : 1n;
    return { days, peak, models, top, tokens, calls: charges.length };
  }, [charges]);

  return (
    <div className={isSample ? "dash dash-sample" : "dash"}>
      <div className="dash-bar">
        <span className="dash-dot" aria-hidden="true" />
        <span className="dash-where">comd.fun/icm</span>
        {isSample && <span className="dash-flag">sample account</span>}
      </div>

      <div className="dash-tiles">
        <div className="dash-tile"><span>Available</span><b>{usd(BigInt(account.balanceMicroUsd || "0"))}</b></div>
        <div className="dash-tile"><span>Calls</span><b>{data.calls.toLocaleString()}</b></div>
        <div className="dash-tile"><span>Tokens</span><b>{short(data.tokens)}</b></div>
        <div className="dash-tile dash-lit"><span>Spent all time</span><b>{usd(BigInt(account.spentMicroUsd || "0"))}</b></div>
      </div>

      <div className="dash-panel">
        <div className="dash-ph"><span>Spend by day</span><span className="muted small">last 14 days</span></div>
        <div className="dash-chart" role="img" aria-label="Spend over the last fourteen days">
          {data.days.map((d, i) => (
            <i key={d.key} style={{ height: `${Math.max(3, Number((d.total * 100n) / data.peak))}%`, ["--i" as string]: i }} />
          ))}
        </div>
      </div>

      {data.models.length > 0 && (
        <div className="dash-panel">
          <div className="dash-ph"><span>By model</span><span className="muted small">top {data.models.length}</span></div>
          <ul className="dash-models">
            {data.models.map(([id, m]) => (
              <li key={id}>
                <span className="dash-m">{id}</span>
                <span className="dash-track"><i style={{ width: `${Math.max(4, Number((m.total * 100n) / data.top))}%` }} /></span>
                <span className="dash-amt">{usd(m.total)}</span>
                <span className="dash-calls">{m.calls} calls</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export const SAMPLE = sample();
