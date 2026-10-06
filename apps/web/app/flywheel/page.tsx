import type { Metadata } from "next";
import Link from "next/link";
import { getFlywheel, toUnits, type FlywheelEvent } from "@/lib/flywheel";
import { addressOf } from "@/lib/contracts";
import { explorerUrl } from "@/lib/chains";
import { ago, fmtNum, short } from "@/lib/format";
import { PageHead, Section, Badge } from "@/components/ui";
import { TaxStage, FlywheelStatsGrid } from "@/components/Flywheel";
import { CountUp } from "@/components/fx/CountUp";
import { VaultNav } from "@/components/VaultNav";
import { TreasuryControls } from "@/components/TreasuryControls";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "The Flywheel" };

const EV: Record<string, { c: string; w: string }> = {
  TaxIn: { c: "gold", w: "Tax in" },
  Buyback: { c: "crimson", w: "Buyback · burn" },
  Swept: { c: "violet", w: "Floor sweep" },
  SweptAwarded: { c: "pink", w: "Awarded" },
  BpsSet: { c: "cyan", w: "Split changed" },
  SwapperSet: { c: "cyan", w: "Swapper set" },
  ComdSet: { c: "cyan", w: "Token set" },
  Flushed: { c: "gold", w: "Flushed" },
  Distributed: { c: "lime", w: "Job revenue" },
};

const C = (v: unknown) => fmtNum(Math.round(toUnits(v as string)));
const E = (v: unknown) => `${toUnits(v as string).toFixed(4)} ETH`;

function evText(e: FlywheelEvent) {
  const id = (v: unknown) => `#${String(v).padStart(4, "0")}`;
  switch (e.type) {
    case "TaxIn": return `${E(e.eth)} of tax arrived from Pons`;
    case "Buyback": return `${E(e.ethIn)} bought ${C(e.comdBurned)} $COMD and sent it to the dead address`;
    case "SwapperSet": return `Buyback swapper set to ${short(e.swapper as string)}`;
    case "ComdSet": return `$COMD token set to ${short(e.comd as string)}`;
    case "Swept": return `Counsel ${id(e.tokenId)} swept off the floor for ${E(e.price)}`;
    case "SweptAwarded": return `Counsel ${id(e.tokenId)} awarded to ${short(e.to as string)}`;
    case "BpsSet": return `Tax split set to ${Number(e.buybackBps) / 100}% burn / ${Number(e.sweepBps) / 100}% sweep`;
    case "Flushed": return `Hook flushed ${E(e.tax)} of held tax to the Flywheel`;
    case "Distributed": return `${C(e.total)} $COMD of job revenue: ${C(e.toRewards)} to Counsel, ${C(e.toTreasury)} to the firm treasury`;
    default: return e.type;
  }
}

export default async function FlywheelPage() {
  const s = await getFlywheel();
  const pct = (b: number) => (b * s.taxBps) / 1_000_000;
  const bucket = (v: string) => toUnits(v);
  const maxB = Math.max(0.0001, bucket(s.buckets.buyback), bucket(s.buckets.sweep));
  const rr = s.revenueRouter;
  const contracts: [string, string | undefined][] = [
    ["ComdToken (Pons)", addressOf("ComdToken")], ["Flywheel", addressOf("Flywheel")], ["Swapper (UniswapV4PoolSwapper)", addressOf("Swapper")],
    ["RevenueRouter", addressOf("RevenueRouter")], ["RewardDistributor", addressOf("RewardDistributor")], ["Incorporations", addressOf("Incorporations")],
  ];
  return (
    <div className="wrap">
      <PageHead
        crumbs={[{ label: "Company.md", href: "/" }, { label: "Treasury", href: "/swap" }, { label: "Flywheel" }]}
        kicker={<><span className="badge brass fill">5% tax · ETH</span><span className="badge crimson" style={{ ["--c" as string]: "var(--crimson)" }}>{pct(s.bps.buyback)}% burn</span><span className="badge violet">{pct(s.bps.sweep)}% sweeps</span><span className="badge ok">80% of job revenue to Counsel</span></>}
        title={<>The <span className="accent">flywheel</span></>}
        lede={<>$COMD launched on <strong>Pons</strong> with a <strong>5% tax in ETH on every buy and sell</strong>. (Pons adds its own 1% protocol fee on top; the firm takes only the 5%.) Pons pays that tax to the Flywheel, which spends it two ways, on-chain, in public, when the firm decides to: <strong>buyback-and-burn</strong> (sent to the dead address) and <strong>Counsel floor sweeps</strong>. Work closes the loop: jobs are paid in $COMD, 80% of it to the Counsel who did them and 20% to the firm treasury.</>}
      />
      <VaultNav active="/flywheel" />
      <div className="fw" style={{ marginBottom: 12 }}>
        <TaxStage s={s} labels="long" />
        <FlywheelStatsGrid s={s} />
      </div>
      {!s.configured && <p className="notice warn small" style={{ marginTop: 12 }}>{s.reason} Every total below starts at zero on deployment.</p>}
      {s.configured && !s.swapper.configured && <p className="notice small" style={{ marginTop: 12 }}><strong>Buybacks start after graduation, once the pool is configured.</strong> Until then the buyback bucket accumulates ETH; floor sweeps run as soon as the sweep bucket can afford a Counsel. <a href={s.pons.url} target="_blank" rel="noreferrer">Trade on Pons</a></p>}
      {s.source === "mock" && <p className="small muted" style={{ marginTop: 10 }}><span className="tag c-orange">mock</span> Fixture numbers until the contracts are live.</p>}
      <TreasuryControls />

      <Section num="§1" title="The buckets" id="buckets" c="gold">
        <div className="grid g2 rv-kids">
          {([["buyback", "Buyback & burn", "crimson", "Keeper calls buyback(minOut): bucket ETH → $COMD through the swapper (Pons's Uniswap v4 pool, after graduation), then sent to the dead address 0x…dEaD."], ["sweep", "Floor sweep", "violet", "Keeper calls sweep(adapter, data, tokenId, maxPrice) on an allowlisted marketplace adapter; price capped by maxSweepPrice."]] as const).map(([k, t, c, d]) => (
            <div key={k} className={`folder rv c-${c}`} data-tab={`${(s.bps[k] / 100).toFixed(0)}% of the tax · ${pct(s.bps[k]).toFixed(1)}% of volume`}>
              <h3 style={{ color: "var(--c)" }}>{t}</h3>
              <div className="num" style={{ fontSize: 40, lineHeight: 1, color: "var(--c)" }}><CountUp value={bucket(s.buckets[k])} format="fixed3" /> <span className="muted" style={{ fontSize: 18 }}>ETH waiting</span></div>
              <div className="meter rv" style={{ ["--c" as string]: "inherit", margin: "10px 0" }}><span style={{ width: `${(bucket(s.buckets[k]) / maxB) * 100}%` }} /></div>
              <p className="small muted" style={{ margin: 0 }}>{d}</p>
            </div>
          ))}
        </div>
        <dl className="kv" style={{ marginTop: 20 }}>
          <dt>ETH spent on buybacks</dt><dd><span className="num" style={{ fontSize: 20 }}>{toUnits(s.totals.boughtBack).toFixed(3)}</span> ETH → {fmtNum(Math.round(toUnits(s.totals.burned)))} $COMD burned</dd>
          <dt>Spent on sweeps</dt><dd><span className="num" style={{ fontSize: 20 }}>{toUnits(s.totals.sweepSpent).toFixed(3)}</span> ETH for {s.totals.swept} Counsel{s.maxSweepPrice ? ` · max ${toUnits(s.maxSweepPrice).toFixed(3)} ETH per sweep` : ""}</dd>
          <dt>Split (owner-settable)</dt><dd>{s.bps.buyback / 100}% / {s.bps.sweep / 100}% of what Pons sends · tax {s.taxBps / 100}%, set in Pons</dd>
          <dt>Buyback swapper</dt><dd>{s.swapper.address ? <><span className="mono small">{short(s.swapper.address, 8, 6)}</span> · {s.swapper.configured ? <span className="ok">pool configured</span> : <span className="muted">pool not configured yet (after graduation)</span>}</> : <span className="muted">not set yet</span>}</dd>
        </dl>
      </Section>

      <Section num="§2" title="The job-payment loop" id="loop" c="pink">
        <div className="loop rv-kids">
          <div className="loop-n rv c-cyan"><b>Client</b><span>retains the firm, pays 100 $COMD per action with one Permit2 signature</span></div>
          <div className="loop-a rv" aria-hidden="true">›</div>
          <div className="loop-n rv c-gold"><b>RevenueRouter</b><span>receives every payment (x402 payTo)</span></div>
          <div className="loop-a rv" aria-hidden="true">›</div>
          <div className="loop-split rv">
            <div className="loop-n c-lime"><b>{rr?.bps ? rr.bps.rewards / 100 : 80}% to Counsel</b><span>{rr?.totalToRewards ? `${fmtNum(Math.round(toUnits(rr.totalToRewards)))} $COMD so far, by accepted work` : "via the RewardDistributor, by accepted work"}</span></div>
            <div className="loop-n c-orange"><b>{rr?.bps ? rr.bps.treasury / 100 : 20}% to the firm</b><span>{rr?.totalToTreasury ? `${fmtNum(Math.round(toUnits(rr.totalToTreasury)))} $COMD so far · compute and gas` : "compute and gas"}</span></div>
          </div>
        </div>
        <p className="small muted rv" style={{ marginTop: 14 }}>Counsel rewards also receive the <strong>1% fee on every Incorporations trade</strong> (Incorporations.totalToRewards). All of it is paid in $COMD, split each epoch by accepted work and claimed by whoever holds the seat. <Link href="/docs/rewards">Rewards &amp; claims</Link></p>
      </Section>

      <Section num="§3" title="The firm's vault · swept Counsel" id="vault" c="violet">
        {s.sweptTokenIds.length === 0 ? <p className="muted">No Counsel swept yet. The first sweep lands here.</p> : (
          <div className="gallery rv-kids">
            {s.sweptTokenIds.map((id) => (
              <Link key={id} href={`/agents/${id}`} className="rv">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/art/${id}.svg`} alt={`Counsel #${id}`} width={112} height={112} loading="lazy" />
                <span className="docket" style={{ color: "var(--violet)" }}>#{String(id).padStart(4, "0")}</span>
              </Link>
            ))}
          </div>
        )}
        <p className="small muted" style={{ marginTop: 12 }}>Swept NFTs are held by the Flywheel contract. The owner can award them (awardSwept) to counsel with standout accepted work.</p>
      </Section>

      <Section num="§4" title="Recent events" id="events" c="cyan">
        {s.events.length === 0 ? <p className="muted">No events yet.</p> : (
          <ul className="feed" style={{ maxHeight: "none" }}>
            {s.events.slice(0, 24).map((e, i) => {
              const st = EV[e.type] ?? { c: "parch", w: e.type };
              return (
                <li key={i} className={`c-${st.c}`} style={{ gridTemplateColumns: "130px minmax(0,1fr) auto" }}>
                  <span><span className="k">{st.w}</span><span className="t">{e.at ? ago(e.at) : e.blockNumber ? `block ${fmtNum(e.blockNumber)}` : ""}</span></span>
                  <span>{evText(e)}</span>
                  {e.txHash ? <a className="small mono ext" href={explorerUrl("tx", e.txHash)} target="_blank" rel="noreferrer">{short(e.txHash, 6, 4)}</a> : <span />}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section num="§5" title="Contracts" id="contracts" c="orange">
        <div className="table-wrap">
          <table className="table collapse">
            <thead><tr><th>Contract</th><th>Address (Robinhood Chain)</th></tr></thead>
            <tbody>{contracts.map(([n, a]) => <tr key={n}><td data-k="Contract">{n}</td><td data-k="Address" className="mono small break">{a ? <a className="ext" href={explorerUrl("address", a)} target="_blank" rel="noreferrer">{a}</a> : <span className="muted">not deployed yet</span>}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="btn-row" style={{ marginTop: 16 }}><Link className="btn primary gold" href="/swap">Trade $COMD</Link><Link className="btn cyan" href="/docs/comd">How it works</Link><Badge tone="bad">Unaudited</Badge></div>
      </Section>
    </div>
  );
}
