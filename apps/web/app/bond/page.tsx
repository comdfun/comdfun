import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui";
import { Bond } from "@/components/tx/Bond";
import { VaultNav } from "@/components/VaultNav";
import { CountUp } from "@/components/fx/CountUp";
import { getFlywheel, toUnits } from "@/lib/flywheel";
import { addressOf } from "@/lib/contracts";
import { explorerUrl } from "@/lib/chains";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bond" };

export default async function BondPage() {
  const s = await getFlywheel();
  const b = s.bond;
  const addr = addressOf("Bond");
  return (
    <div className="wrap">
      <PageHead
        crumbs={[{ label: "Company.md", href: "/" }, { label: "Vault", href: "/swap" }, { label: "Bond" }]}
        kicker={<><span className="badge orange fill">ETH → COMD</span><span className="badge brass">6% of every trim</span><span className="badge violet">Fixed price</span></>}
        title={<>The <span className="accent">bond</span></>}
        lede={<>6% of every COMD the pool trims fills the <strong>bond reserve</strong>. Once the firm opens it, anyone can buy from the reserve <strong>with ETH at a fixed price</strong>, untaxed, in one transaction. The ETH goes to the firm treasury.</>}
      />
      <VaultNav active="/bond" />
      <div className="stats rv-kids" style={{ marginBottom: 22 }}>
        <div className="stat rv c-orange"><CountUp className="v" value={toUnits(b?.reserve)} format="compact" /><span className="k">COMD in reserve</span></div>
        <div className="stat rv c-gold"><CountUp className="v" value={b?.priceEth ? Number(BigInt(b.priceEth)) / 1e12 : 0} format="fixed3" /><span className="k">ETH per 1M COMD</span></div>
        <div className="stat rv c-lime"><CountUp className="v" value={toUnits(b?.sold)} format="compact" /><span className="k">COMD bonded so far</span></div>
        <div className="stat rv c-violet"><CountUp className="v" value={toUnits(b?.proceeds)} format="fixed3" /><span className="k">ETH raised</span></div>
      </div>
      {s.source === "mock" && <p className="small muted" style={{ marginTop: -10, marginBottom: 16 }}><span className="tag c-orange">mock</span> Fixture numbers until the bond is live.</p>}
      <div className="grid trade-grid">
        <Bond />
        <div className="stack">
          <div className="dossier c-orange rv" data-tab="How the bond works">
            <div className="dossier-head"><span className="eng">The reserve</span><span className="eng-r">ComdTaxHook → Bond → treasury</span></div>
            <div className="dossier-body">
              <ol className="entries">
                <li className="c-cyan"><span className="no">01</span><span><span className="t">Trims fill it</span><span className="d">6% of every trimmed or wall-bought COMD lands in the reserve. <Link href="/flywheel#pool">The capped pool</Link></span></span></li>
                <li className="c-orange"><span className="no">02</span><span><span className="t">A fixed price in ETH</span><span className="d">The firm sets <code>priceEth</code> (wei per COMD) and opens the bond. <code>quote(ethIn)</code> tells you exactly what you get.</span></span></li>
                <li className="c-lime"><span className="no">03</span><span><span className="t">Paid out at once</span><span className="d"><code>buyWithEth(minOut)</code> sends the COMD to you in the same transaction. No tax, no slippage beyond the price.</span></span></li>
              </ol>
            </div>
          </div>
          <div className="panel c-gold rv">
            <h3>Contract</h3>
            <dl className="kv">
              <dt>Bond</dt><dd>{addr ? <a className="mono ext break" href={explorerUrl("address", addr)} target="_blank" rel="noreferrer">{addr}</a> : <span className="muted">not deployed yet</span>}</dd>
              <dt>Status</dt><dd>{b ? (b.enabled ? "Open" : "Not open yet") : "—"}</dd>
            </dl>
          </div>
          <p className="small muted rv">Unaudited contracts. Nothing here is financial advice. <Link href="/docs/comd">$COMD docs</Link></p>
        </div>
      </div>
    </div>
  );
}
