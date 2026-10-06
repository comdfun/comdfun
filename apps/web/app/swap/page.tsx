import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui";
import { VaultNav } from "@/components/VaultNav";
import { TradeCards } from "@/components/TradeCards";
import { addressOf } from "@/lib/contracts";
import { explorerUrl } from "@/lib/chains";
import { getFlywheel } from "@/lib/flywheel";
import { PONS_URL, UNISWAP_URL } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Trade $COMD" };

export default async function TradePage() {
  const token = addressOf("ComdToken");
  const swapper = addressOf("Swapper");
  const s = await getFlywheel();
  const graduated = s.swapper.configured || !!UNISWAP_URL;
  return (
    <div className="wrap">
      <PageHead
        crumbs={[{ label: "Company.md", href: "/" }, { label: "Treasury", href: "/swap" }, { label: "Trade" }]}
        kicker={<><span className="badge brass fill">Launched on Pons</span><span className="badge pink">5% tax in ETH</span><span className="badge violet">Feeds the flywheel</span></>}
        title={<>Trade <span className="accent">$COMD</span></>}
        lede={<><strong>$COMD</strong> launched on <strong>Pons</strong>, the Robinhood Chain launchpad: 1,000,000,000 minted there, traded on its bonding curve, and on graduation locked by Pons into a Uniswap v4 pool. Every buy and sell pays a 5% tax in ETH that Pons sends to the Flywheel.</>}
      />
      <VaultNav active="/swap" />
      <div className="grid trade-grid">
        <TradeCards ponsUrl={s.pons.url || PONS_URL} uniswapUrl={UNISWAP_URL} graduated={graduated} />
        <div className="stack">
          <div className="dossier c-violet rv" data-tab="Where the 5% goes">
            <div className="dossier-head"><span className="eng">The tax, in ETH</span><span className="eng-r">Pons → Flywheel</span></div>
            <div className="dossier-body">
              <ol className="entries">
                <li className="c-crimson"><span className="no">2.5</span><span><span className="t">Buyback &amp; burn</span><span className="d">The Flywheel buys $COMD from the pool and sends it to the dead address. <Link href="/flywheel">Buybacks start after graduation.</Link></span></span></li>
                <li className="c-violet"><span className="no">2.5</span><span><span className="t">Counsel floor sweeps</span><span className="d">Buys Counsel NFTs off the floor into the firm&apos;s vault, to be awarded to top counsel.</span></span></li>
                <li className="c-lime"><span className="no">80%</span><span><span className="t">And work pays Counsel</span><span className="d">Jobs are paid in $COMD: 80% to the Counsel who did the work, 20% to the firm treasury. <Link href="/flywheel#loop">The loop</Link></span></span></li>
              </ol>
            </div>
          </div>
          <div className="panel c-gold rv">
            <h3>The token</h3>
            <dl className="kv">
              <dt>Supply</dt><dd>1,000,000,000 $COMD, minted once by Pons. No team allocation, no mint function.</dd>
              <dt>Liquidity</dt><dd>Locked by Pons at graduation in a full-range Uniswap v4 position with Pons&apos;s hook.</dd>
              <dt>Tax</dt><dd>5% of every buy and sell, in ETH, set in Pons, to the Flywheel. Pons charges its own 1% protocol fee on top (6% per trade in total; the firm takes only the 5%). Wallet transfers and Permit2 payments are untaxed.</dd>
              <dt>Token</dt><dd>{token ? <a className="mono ext break" href={explorerUrl("token", token)} target="_blank" rel="noreferrer">{token}</a> : <span className="muted">address appears after the Pons launch</span>}</dd>
              <dt>Buyback swapper</dt><dd>{swapper ? <a className="mono ext break" href={explorerUrl("address", swapper)} target="_blank" rel="noreferrer">{swapper}</a> : <span className="muted">not deployed yet</span>}{s.swapper.configured ? <> · <span className="ok">pool configured</span></> : <> · <span className="muted">pool not configured yet</span></>}</dd>
            </dl>
          </div>
          <p className="small muted rv">Pons and Uniswap are third-party sites. Nothing here is financial advice. <Link href="/docs/security">Security</Link></p>
        </div>
      </div>
    </div>
  );
}
