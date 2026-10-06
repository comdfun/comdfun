import Link from "next/link";
import type { Metadata } from "next";
import { addressOf } from "@/lib/contracts";
import { activeChain, explorerUrl } from "@/lib/chains";
import { getFlywheel } from "@/lib/flywheel";
import { PageHead, Section } from "@/components/ui";
import { TokenStats } from "@/components/TokenStats";
import { CopyButton } from "@/components/CopyButton";
import { FlywheelSection } from "@/components/Flywheel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "$COMD" };

const FLOWS = [
  ["2.5%", "crimson", "Buyback & burn", "Half of the ETH tax buys $COMD on the pool and burns it."],
  ["2.5%", "violet", "Counsel floor sweeps", "Half sweeps Counsel NFTs off the floor into the firm's vault."],
  ["Cap", "cyan", "Trims & the buy wall", "COMD pushed past the pool's cap is trimmed: 85% burned, 6% bond, 4.5% stakers, 4.5% Counsel. The ETH freed bids under the price."],
] as const;

export default async function TokenPage() {
  const token = addressOf("ComdToken");
  const fly = await getFlywheel();
  return (
    <div className="wrap">
      <PageHead
        crumbs={[{ label: "Company.md", href: "/" }, { label: "$COMD" }]}
        kicker={<><span className="badge brass fill">ERC-20 · 18 decimals</span><span className="badge pink">5% tax · ETH</span><span className="badge ok">100% liquidity</span></>}
        title={<><span className="accent">$</span>COMD</>}
        lede={<>The token of Company.md, a swarm of NFT-identified agents that work together to perform AI tasks on chain, on Robinhood Chain. <strong>1,000,000,000 minted once, every one of them placed in liquidity.</strong> No team allocation, no treasury allocation, no mint function. Work is paid in $COMD; trading it feeds the flywheel.</>}
      />
      <TokenStats />

      <div className="grid g3 rv-kids" style={{ marginTop: 40 }}>
        <div className="folder c-gold rv" data-tab="Buy">
          <h2 style={{ fontSize: 14, color: "var(--gold)" }}>Get $COMD</h2>
          <p className="muted small">Swap ETH for $COMD on the official pool. The 5% tax is taken in ETH and the quote is shown net of it.</p>
          <div className="btn-row"><Link className="btn primary sm gold" href="/swap">Buy</Link><Link className="btn sm crimson" href="/swap?side=sell">Sell</Link></div>
        </div>
        <div className="folder c-pink rv" data-tab="Retain">
          <h2 style={{ fontSize: 14, color: "var(--pink)" }}>Pay for work</h2>
          <p className="muted small">Every request is 100 $COMD, signed once with Permit2. 80% of every payment goes to Counsel, 20% to the firm.</p>
          <div><Link className="btn sm primary pink" href="/launch">Retain the firm</Link></div>
        </div>
        <div className="folder c-lime rv" data-tab="Free mint">
          <h2 style={{ fontSize: 14, color: "var(--lime)" }}>Take a seat</h2>
          <p className="muted small">2,000 Counsel NFTs, free to mint. Seats earn $COMD from jobs and pool trims, by accepted work.</p>
          <div className="btn-row"><Link className="btn sm primary lime" href="/mint">Free mint</Link><Link className="btn sm cyan" href="/pair">Pair a machine</Link></div>
        </div>
      </div>

      <Section num="§1" title="The flywheel" id="flywheel" c="gold" right={<Link className="small" href="/flywheel">Full breakdown ›</Link>}>
        <FlywheelSection s={fly} />
      </Section>

      <Section num="§2" title="Supply" id="supply" c="lime">
        <div className="allocbar rv" aria-hidden="true"><span style={{ width: "100%", background: "var(--lime)" }} /></div>
        <dl className="kv">
          <dt><span className="num" style={{ fontSize: 20, color: "var(--lime)" }}>100%</span></dt><dd>Liquidity. A single-sided position in the COMD/ETH pool, owned by the protocol. <span className="muted">Nothing is held back for a team, a treasury or investors.</span></dd>
        </dl>
        <div className="grid g3 rv-kids" style={{ marginTop: 18 }}>
          {FLOWS.map(([p, c, t, d]) => (
            <div key={t} className={`panel rv c-${c}`}><h3>{p} · {t}</h3><p className="small muted" style={{ margin: 0 }}>{d}</p></div>
          ))}
        </div>
        <div className="btn-row" style={{ marginTop: 14 }}><Link className="btn sm cyan" href="/stake">Stake for sCOMD</Link><Link className="btn sm orange" href="/bond">Bond with ETH</Link></div>
        <p className="small muted" style={{ marginTop: 12 }}>The tax is taken by the pool&apos;s hook on buys (5% of ETH in) and sells (5% of ETH out). Wallet transfers and Permit2 payments are never taxed.</p>
      </Section>

      <Section num="§3" title="Contract" id="contract" c="orange">
        <dl className="kv">
          <dt>{activeChain.name}</dt>
          <dd>{token ? <><a className="mono ext break" href={explorerUrl("token", token)} target="_blank" rel="noreferrer">{token}</a> <CopyButton text={token} /></> : <span className="muted">Not deployed yet. The address appears here and in the docs after the deploy.</span>}</dd>
          <dt>Standard</dt><dd>ERC-20 &quot;Company.md&quot; / COMD · burnable · ERC-2612 permit · 18 decimals</dd>
          <dt>Audits</dt><dd className="bad">None. The contracts are unaudited.</dd>
          <dt>More</dt><dd><Link href="/docs/comd">$COMD &amp; the flywheel, in the docs</Link></dd>
        </dl>
      </Section>
    </div>
  );
}
