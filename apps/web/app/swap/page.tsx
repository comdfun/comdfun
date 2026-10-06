import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui";
import { VaultNav } from "@/components/VaultNav";
import { Swap } from "@/components/tx/Swap";
import { one, type Params } from "@/components/Listing";
import { addressOf } from "@/lib/contracts";
import { explorerUrl } from "@/lib/chains";

export const metadata: Metadata = { title: "Swap $COMD" };

export default async function SwapPage({ searchParams }: { searchParams: Promise<Params> }) {
  const side = one((await searchParams).side) === "sell" ? "sell" : "buy";
  const router = addressOf("ComdRouter");
  const hook = addressOf("ComdTaxHook");
  return (
    <div className="wrap">
      <PageHead
        crumbs={[{ label: "Company.md", href: "/" }, { label: "Swap" }]}
        kicker={<><span className="badge brass fill">ETH ↔ $COMD</span><span className="badge pink">5% tax in ETH</span><span className="badge violet">Feeds the flywheel</span></>}
        title={<>Swap <span className="accent">$COMD</span></>}
        lede={<>Trade on the official COMD/ETH pool through <strong>ComdRouter</strong>. Every buy and sell pays a 5% tax in ETH to the Flywheel; the quote you see is already net of it.</>}
      />
      <VaultNav active="/swap" />
      <div className="grid trade-grid">
        <Swap initialSide={side} />
        <div className="stack">
          <div className="dossier c-violet rv" data-tab="Where the 5% goes">
            <div className="dossier-head"><span className="eng">The tax, in ETH</span><span className="eng-r">ComdTaxHook → Flywheel</span></div>
            <div className="dossier-body">
              <ol className="entries">
                <li className="c-crimson"><span className="no">2.5</span><span><span className="t">Buyback &amp; burn</span><span className="d">The Flywheel buys $COMD on this pool and burns it.</span></span></li>
                <li className="c-violet"><span className="no">2.5</span><span><span className="t">Counsel floor sweeps</span><span className="d">Buys Counsel NFTs off the floor into the firm&apos;s vault, to be awarded to top counsel.</span></span></li>
                <li className="c-cyan"><span className="no">cap</span><span><span className="t">And the capped pool</span><span className="d">Sells that push the pool&apos;s COMD past its cap get trimmed: 85% burned, the rest to the bond, stakers and Counsel. <Link href="/flywheel#pool">How</Link></span></span></li>
              </ol>
            </div>
          </div>
          <div className="panel c-gold rv">
            <h3>The pool</h3>
            <dl className="kv">
              <dt>Liquidity</dt><dd>100% of the 1,000,000,000 supply, single-sided, owned by the protocol</dd>
              <dt>Tax</dt><dd>5% of ETH in on a buy; 5% of ETH out on a sell. Wallet transfers and payments are untaxed.</dd>
              <dt>Router</dt><dd>{router ? <a className="mono ext" href={explorerUrl("address", router)} target="_blank" rel="noreferrer">{router}</a> : <span className="muted">not deployed yet</span>}</dd>
              <dt>Tax hook</dt><dd>{hook ? <a className="mono ext" href={explorerUrl("address", hook)} target="_blank" rel="noreferrer">{hook}</a> : <span className="muted">not deployed yet</span>}</dd>
            </dl>
          </div>
          <p className="small muted rv">Unaudited contracts. Nothing here is financial advice. <Link href="/docs/security">Security</Link></p>
        </div>
      </div>
    </div>
  );
}
