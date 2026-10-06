import type { Metadata } from "next";
import Link from "next/link";
import { getFlywheel, toUnits, stakingApr, type FlywheelEvent } from "@/lib/flywheel";
import { addressOf } from "@/lib/contracts";
import { explorerUrl } from "@/lib/chains";
import { ago, fmtNum, short } from "@/lib/format";
import { PageHead, Section, Badge } from "@/components/ui";
import { TaxStage, PoolStage, FlywheelStatsGrid, PoolStatsGrid, CapMeter, TrimSplit } from "@/components/Flywheel";
import { CountUp } from "@/components/fx/CountUp";
import { VaultNav } from "@/components/VaultNav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "The Flywheel" };

const EV: Record<string, { c: string; w: string }> = {
  TaxIn: { c: "gold", w: "Tax in" },
  Buyback: { c: "crimson", w: "Buyback · burn" },
  Swept: { c: "violet", w: "Floor sweep" },
  SweptAwarded: { c: "pink", w: "Awarded" },
  BpsSet: { c: "cyan", w: "Split changed" },
  Trimmed: { c: "orange", w: "Trim" },
  Split: { c: "crimson", w: "Trim split" },
  Flushed: { c: "gold", w: "Flushed" },
  CapUpdated: { c: "cyan", w: "Cap moved" },
  Rebalanced: { c: "violet", w: "Wall rebalance" },
  WallPosted: { c: "violet", w: "Wall posted" },
  WallClosed: { c: "violet", w: "Wall filled" },
  WallParked: { c: "violet", w: "Wall parked" },
  Dripped: { c: "cyan", w: "Staker drip" },
  RewardNotified: { c: "cyan", w: "Staker reward" },
  Bonded: { c: "orange", w: "Bond" },
  Distributed: { c: "lime", w: "Job revenue" },
};

const ethPerM = (wei?: string) => (wei ? (Number(BigInt(wei)) / 1e12).toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—");
const C = (v: unknown) => fmtNum(Math.round(toUnits(v as string)));
const E = (v: unknown) => `${toUnits(v as string).toFixed(4)} ETH`;

function evText(e: FlywheelEvent) {
  const id = (v: unknown) => `#${String(v).padStart(4, "0")}`;
  switch (e.type) {
    case "TaxIn": return `${E(e.eth)} of tax arrived from the pool`;
    case "Buyback": return `${E(e.ethIn)} bought ${C(e.comdBurned)} $COMD and burned it`;
    case "Swept": return `Counsel ${id(e.tokenId)} swept off the floor for ${E(e.price)}`;
    case "SweptAwarded": return `Counsel ${id(e.tokenId)} awarded to ${short(e.to as string)}`;
    case "BpsSet": return `Tax split set to ${Number(e.buybackBps) / 100}% burn / ${Number(e.sweepBps) / 100}% sweep`;
    case "Trimmed": return `The pool trimmed ${C(e.comdOut)} $COMD over the cap, freeing ${E(e.ethOut)}`;
    case "Split": return `${C(e.amount)} $COMD split: ${C(e.burned)} burned, ${C(e.toBond)} to the bond, ${C(e.toStakers)} to stakers, ${C(e.toSeats)} to Counsel`;
    case "Flushed": return `Hook flushed ${E(e.tax)} of tax and ${E(e.trimEth)} of trim ETH`;
    case "CapUpdated": return `Cap now ${C(e.cap)} $COMD (inventory ${C(e.inventory)})`;
    case "Rebalanced": return `Keeper ${short(e.keeper as string)} rebalanced the wall (${E(e.ethHandled)})`;
    case "WallPosted": return `Buy wall posted with ${E(e.eth)}`;
    case "WallClosed": return `Buy wall filled: ${C(e.comdBought)} $COMD bought`;
    case "WallParked": return `${E(e.eth)} parked until the price returns to the floor`;
    case "Dripped": return `${C(e.amount)} $COMD streamed to sCOMD stakers`;
    case "RewardNotified": return `${C(e.amount)} $COMD queued for stakers`;
    case "Bonded": return `${short(e.buyer as string)} bonded ${E(e.ethIn)} for ${C(e.comdOut)} $COMD`;
    case "Distributed": return `${C(e.total)} $COMD of job revenue: ${C(e.toRewards)} to Counsel, ${C(e.toTreasury)} to the firm`;
    default: return e.type;
  }
}

export default async function FlywheelPage() {
  const s = await getFlywheel();
  const pct = (b: number) => (b * s.taxBps) / 1_000_000;
  const bucket = (v: string) => toUnits(v);
  const maxB = Math.max(0.0001, bucket(s.buckets.buyback), bucket(s.buckets.sweep));
  const rr = s.revenueRouter;
  const w = s.buyWall;
  const apr = stakingApr(s.staking);
  const contracts: [string, string | undefined][] = [
    ["Flywheel", addressOf("Flywheel")], ["ComdTaxHook", addressOf("ComdTaxHook")], ["BuyWall", addressOf("BuyWall")], ["StakedComd", addressOf("StakedComd")], ["RewardDripper", addressOf("RewardDripper")],
    ["Bond", addressOf("Bond")], ["ComdRouter", addressOf("ComdRouter")], ["RevenueRouter", addressOf("RevenueRouter")], ["RewardDistributor", addressOf("RewardDistributor")], ["ComdToken", addressOf("ComdToken")],
  ];
  const totalBurned = toUnits(s.totals.burned) + toUnits(s.hook?.stats.burned);
  return (
    <div className="wrap">
      <PageHead
        crumbs={[{ label: "Company.md", href: "/" }, { label: "Vault", href: "/swap" }, { label: "Flywheel" }]}
        kicker={<><span className="badge brass fill">5% tax · ETH</span><span className="badge crimson" style={{ ["--c" as string]: "var(--crimson)" }}>{pct(s.bps.buyback)}% burn</span><span className="badge violet">{pct(s.bps.sweep)}% sweeps</span><span className="badge cyan" style={{ ["--c" as string]: "var(--cyan)" }}>Capped pool</span></>}
        title={<>The <span className="accent">flywheel</span></>}
        lede={<>All of $COMD is in one pool, and two engines run on it. <strong>The tax wheel</strong> takes 5% of every buy and sell in ETH and spends it on buybacks and Counsel floor sweeps. <strong>The capped pool</strong>, inspired by IMD, trims the COMD that sells push past a cap, burns most of it, and posts the ETH it frees as a buy wall.</>}
      />
      <VaultNav active="/flywheel" />
      <div className="engine-grid" style={{ marginBottom: 14 }}>
        <div className="engine c-gold">
          <div className="engine-h"><span className="engine-n">I</span><span><b>The tax wheel</b><span>5% of every trade, in ETH</span></span></div>
          <TaxStage s={s} labels="long" />
        </div>
        <div className="engine c-cyan">
          <div className="engine-h"><span className="engine-n">II</span><span><b>The capped pool</b><span>Trims · buy wall · stakers · bond</span></span></div>
          <PoolStage s={s} />
        </div>
      </div>
      <div className="stats rv-kids" style={{ marginBottom: 6 }}>
        <div className="stat rv c-crimson"><CountUp className="v" value={totalBurned} format="compact" /><span className="k">$COMD burned, both engines</span></div>
        <div className="stat rv c-violet"><CountUp className="v" value={toUnits(w?.postedEth)} format="fixed3" /><span className="k">ETH on the buy wall</span></div>
        <div className="stat rv c-gold"><CountUp className="v" value={s.totals.swept} /><span className="k">Counsel swept</span></div>
        <div className="stat rv c-cyan"><CountUp className="v" value={apr != null ? apr * 100 : 0} format="fixed1" /><span className="k">sCOMD APR, % (stream)</span></div>
      </div>
      {!s.configured && <p className="notice warn small" style={{ marginTop: 12 }}>{s.reason} Every total below starts at zero on deployment.</p>}
      {s.source === "mock" && <p className="small muted" style={{ marginTop: 10 }}><span className="tag c-orange">mock</span> Fixture numbers until the contracts are live.</p>}

      <Section num="§1" title="Engine I · The tax wheel" id="tax" c="gold">
        <FlywheelStatsGrid s={s} />
        <div className="grid g2 rv-kids" style={{ marginTop: 18 }}>
          {([["buyback", "Buyback & burn", "crimson", "Keeper calls buyback(minOut): ETH → $COMD through ComdRouter (tax-exempt for the Flywheel), then burned."], ["sweep", "Floor sweep", "violet", "Keeper calls sweep(adapter, data, tokenId, maxPrice) on an allowlisted marketplace adapter; price capped by maxSweepPrice."]] as const).map(([k, t, c, d]) => (
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
          <dt>Split (owner-settable)</dt><dd>{s.bps.buyback / 100}% / {s.bps.sweep / 100}% of the tax · tax {s.taxBps / 100}% (hard cap 5%)</dd>
        </dl>
      </Section>

      <Section num="§2" title="Engine II · The capped pool" id="pool" c="cyan">
        <p className="lede rv" style={{ marginTop: 0 }}>The pool keeps a <strong>cap</strong> on the COMD it holds. When a sell pushes its inventory over the cap, the hook <strong>trims</strong> the excess liquidity (your quote is unchanged). The COMD it pulls out is split below; the ETH it frees goes to the <strong>buy wall</strong>. The cap never rises: it decays (up to {fmtNum(Math.round(toUnits(s.hook?.params?.capDecayPerDay) || 100_000))} COMD a day) toward the pool&apos;s inventory, so COMD that buyers take out cannot be sold back in untrimmed.</p>
        <CapMeter h={s.hook} />
        <div className="grid g2" style={{ marginTop: 22, alignItems: "start" }}>
          <div>
            <h3 className="label" style={{ marginBottom: 10 }}>Every trimmed COMD</h3>
            <TrimSplit h={s.hook} />
          </div>
          <div className="folder c-violet rv" data-tab="The buy wall">
            <h3 style={{ color: "var(--violet)" }}>A standing bid under the price</h3>
            <p className="small muted" style={{ marginTop: 0 }}>The ETH freed by trims is posted as liquidity just below the market. When the price falls into it, the wall buys COMD, and that COMD takes the same 85 / 6 / 4.5 / 4.5 split. The floor can only move {s.hook?.params?.refStepTicks ?? 200} ticks a day; a keeper calls <code>rebalance()</code> for a small tip.</p>
            <dl className="kv">
              <dt>ETH on the wall</dt><dd><span className="num" style={{ fontSize: 20, color: "var(--violet)" }}>{toUnits(w?.postedEth).toFixed(3)}</span> ETH{w && toUnits(w.parkedEth) > 0 ? ` · ${toUnits(w.parkedEth).toFixed(3)} parked` : ""}</dd>
              <dt>COMD bought by the wall</dt><dd>{fmtNum(Math.round(toUnits(w?.totalBought)))}</dd>
              <dt>Floor tick</dt><dd className="mono">{w ? `${w.floorTick} → ${w.previewFloorTick}` : "—"}</dd>
              <dt>Keeper tips</dt><dd>{toUnits(w?.totalTips).toFixed(4)} ETH{w?.canRebalance ? " · rebalance due" : ""}</dd>
            </dl>
          </div>
        </div>
        <div style={{ marginTop: 22 }}><PoolStatsGrid s={s} /></div>
      </Section>

      <Section num="§3" title="Stakers and the bond" id="vault-flows" c="orange">
        <div className="grid g2 rv-kids">
          <div className="folder c-cyan rv" data-tab="sCOMD">
            <h3 style={{ color: "var(--cyan)" }}>Stake COMD, earn the stream</h3>
            <p className="small muted" style={{ marginTop: 0 }}>4.5% of every trim (and the 1% Incorporations fee) is streamed to sCOMD holders by the RewardDripper, capped per day.</p>
            <dl className="kv">
              <dt>Total staked</dt><dd>{fmtNum(Math.round(toUnits(s.staking?.totalAssets)))} COMD</dd>
              <dt>APR (current stream)</dt><dd>{apr != null ? `${(apr * 100).toFixed(1)}%` : "—"}</dd>
              <dt>Stream cap</dt><dd>{fmtNum(Math.round(toUnits(s.staking?.streamCapPerDay)))} COMD / day</dd>
            </dl>
            <Link className="btn sm cyan" href="/stake">Stake ›</Link>
          </div>
          <div className="folder c-orange rv" data-tab="Bond">
            <h3 style={{ color: "var(--orange)" }}>The bond reserve, for ETH</h3>
            <p className="small muted" style={{ marginTop: 0 }}>6% of every trim fills the bond reserve, sold for ETH at a fixed owner-set price once enabled. Proceeds go to the firm treasury.</p>
            <dl className="kv">
              <dt>Reserve</dt><dd>{fmtNum(Math.round(toUnits(s.bond?.reserve)))} COMD</dd>
              <dt>Price</dt><dd>{s.bond ? `${ethPerM(s.bond.priceEth)} ETH per 1M COMD` : "—"}</dd>
              <dt>Status</dt><dd>{s.bond?.enabled ? <Badge tone="ok">Open</Badge> : <Badge tone="orange">Not yet open</Badge>}</dd>
            </dl>
            <Link className="btn sm orange" href="/bond">Bond ›</Link>
          </div>
        </div>
      </Section>

      <Section num="§4" title="The job-payment loop" id="loop" c="pink">
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
      </Section>

      <Section num="§5" title="The firm's vault · swept Counsel" id="vault" c="violet">
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

      <Section num="§6" title="Recent events" id="events" c="cyan">
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

      <Section num="§7" title="Contracts" id="contracts" c="orange">
        <div className="table-wrap">
          <table className="table collapse">
            <thead><tr><th>Contract</th><th>Address (Robinhood Chain)</th></tr></thead>
            <tbody>{contracts.map(([n, a]) => <tr key={n}><td data-k="Contract">{n}</td><td data-k="Address" className="mono small break">{a ? <a className="ext" href={explorerUrl("address", a)} target="_blank" rel="noreferrer">{a}</a> : <span className="muted">not deployed yet</span>}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="btn-row" style={{ marginTop: 16 }}><Link className="btn primary gold" href="/swap">Buy $COMD</Link><Link className="btn cyan" href="/docs/comd">How it works</Link><Badge tone="bad">Unaudited</Badge></div>
      </Section>
    </div>
  );
}
