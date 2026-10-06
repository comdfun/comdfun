import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui";
import { Stake } from "@/components/tx/Stake";
import { VaultNav } from "@/components/VaultNav";
import { CountUp } from "@/components/fx/CountUp";
import { getFlywheel, stakingApr, sumEvents, toUnits } from "@/lib/flywheel";
import { addressOf } from "@/lib/contracts";
import { explorerUrl } from "@/lib/chains";
import { fmtNum } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Stake $COMD" };

export default async function StakePage() {
  const s = await getFlywheel();
  const st = s.staking;
  const apr = stakingApr(st);
  const dripped7 = sumEvents(s.events, "Dripped", "amount", 7);
  const week = dripped7 > 0 ? dripped7 : toUnits(st?.ratePerSecond) * 7 * 86_400;
  const vault = addressOf("StakedComd");
  const dripper = addressOf("RewardDripper");
  return (
    <div className="wrap">
      <PageHead
        crumbs={[{ label: "Company.md", href: "/" }, { label: "Vault", href: "/swap" }, { label: "Stake" }]}
        kicker={<><span className="badge cyan fill" style={{ ["--c" as string]: "var(--cyan)" }}>sCOMD · ERC-4626</span><span className="badge orange">4.5% of every trim</span><span className="badge violet">No lockup</span></>}
        title={<>Stake <span className="accent">$COMD</span></>}
        lede={<>Deposit COMD, hold <strong>sCOMD</strong>. 4.5% of every COMD the pool trims, and the 1% fee on every Incorporations trade, is streamed into the vault by the <strong>RewardDripper</strong>, so each sCOMD redeems for more COMD over time.</>}
      />
      <VaultNav active="/stake" />
      <div className="stats rv-kids" style={{ marginBottom: 22 }}>
        <div className="stat rv c-cyan"><CountUp className="v" value={apr != null ? apr * 100 : 0} format="fixed1" /><span className="k">APR, % (current stream)</span></div>
        <div className="stat rv c-gold"><CountUp className="v" value={toUnits(st?.totalAssets)} format="compact" /><span className="k">COMD staked</span></div>
        <div className="stat rv c-lime"><CountUp className="v" value={week} format="compact" /><span className="k">Rewards, last 7 days{dripped7 > 0 ? "" : " (est.)"}</span></div>
        <div className="stat rv c-violet"><CountUp className="v" value={toUnits(st?.streamCapPerDay)} format="compact" /><span className="k">Stream cap, COMD / day</span></div>
        <div className="stat rv c-orange"><CountUp className="v" value={st?.totalAssets && st.totalShares && toUnits(st.totalShares, 24) > 0 ? toUnits(st.totalAssets) / toUnits(st.totalShares, 24) : 1} format="fixed3" /><span className="k">COMD per sCOMD</span></div>
      </div>
      {s.source === "mock" && <p className="small muted" style={{ marginTop: -10, marginBottom: 16 }}><span className="tag c-orange">mock</span> Fixture numbers until the vault is live.</p>}
      <div className="grid trade-grid">
        <Stake />
        <div className="stack">
          <div className="dossier c-cyan rv" data-tab="How staking pays">
            <div className="dossier-head"><span className="eng">The stream</span><span className="eng-r">ComdTaxHook → RewardDripper → sCOMD</span></div>
            <div className="dossier-body">
              <ol className="entries">
                <li className="c-orange"><span className="no">01</span><span><span className="t">The pool trims</span><span className="d">Sells push the pool&apos;s COMD past its cap; the excess is pulled out and split. <Link href="/flywheel#pool">The capped pool</Link></span></span></li>
                <li className="c-cyan"><span className="no">02</span><span><span className="t">4.5% to the dripper</span><span className="d">Along with the 1% Incorporations fee. Rewards stream out over a window, capped per day, so a big trim can&apos;t be sniped.</span></span></li>
                <li className="c-lime"><span className="no">03</span><span><span className="t">The share price rises</span><span className="d">Nothing to claim: your sCOMD redeems for more COMD. Unstake whenever you like.</span></span></li>
              </ol>
            </div>
          </div>
          <div className="panel c-gold rv">
            <h3>Contracts</h3>
            <dl className="kv">
              <dt>StakedComd</dt><dd>{vault ? <a className="mono ext break" href={explorerUrl("address", vault)} target="_blank" rel="noreferrer">{vault}</a> : <span className="muted">not deployed yet</span>}</dd>
              <dt>RewardDripper</dt><dd>{dripper ? <a className="mono ext break" href={explorerUrl("address", dripper)} target="_blank" rel="noreferrer">{dripper}</a> : <span className="muted">not deployed yet</span>}</dd>
              <dt>Streamed so far</dt><dd>{fmtNum(Math.round(toUnits(st?.totalDripped)))} COMD</dd>
            </dl>
          </div>
          <p className="small muted rv">APR is the current stream rate over the COMD staked; it moves with trading. Unaudited contracts. Nothing here is financial advice. <Link href="/docs/rewards">Rewards docs</Link></p>
        </div>
      </div>
    </div>
  );
}
