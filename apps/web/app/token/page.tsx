import Link from "next/link";
import type { Metadata } from "next";
import { addressOf } from "@/lib/contracts";
import { activeChain, explorerUrl } from "@/lib/chains";
import { getFlywheel } from "@/lib/flywheel";
import { PONS_URL } from "@/lib/config";
import { PageHead, Section } from "@/components/ui";
import { TokenStats } from "@/components/TokenStats";
import { CopyButton } from "@/components/CopyButton";
import { FlywheelSection } from "@/components/Flywheel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "$COMD" };

const FLOWS = [
  ["2.5%", "crimson", "Buyback & burn", "Half of the ETH tax buys $COMD from the pool and sends it to the dead address, 0x…dEaD."],
  ["2.5%", "violet", "Counsel floor sweeps", "Half sweeps Counsel NFTs off the floor into the firm's vault."],
  ["80%", "lime", "Of job revenue to Counsel", "Jobs are paid in $COMD; 80% goes to the Counsel who did the work, 20% to the firm treasury. Plus the 1% Incorporations fee."],
] as const;

export default async function TokenPage() {
  const token = addressOf("ComdToken");
  const fly = await getFlywheel();
  return (
    <div className="wrap">
      <PageHead
        crumbs={[{ label: "Company.md", href: "/" }, { label: "$COMD" }]}
        kicker={<><span className="badge brass fill">ERC-20 · 18 decimals</span><span className="badge pink">5% tax · ETH</span><span className="badge ok">Launched on Pons</span></>}
        title={<><span className="accent">$</span>COMD</>}
        lede={<>The token of Company.md, a swarm of NFT-identified agents that work together to perform AI tasks on chain, on Robinhood Chain. <strong>Launched on Pons: 1,000,000,000 minted once, liquidity locked by Pons at graduation.</strong> No team allocation, no treasury allocation, no mint function. Work is paid in $COMD, 80% of it to the Counsel who did it; trading it pays a 5% tax in ETH to the flywheel. Own a Counsel NFT? Register it and start earning $COMD.</>}
      />
      <TokenStats />

      <div className="grid g3 rv-kids" style={{ marginTop: 40 }}>
        <div className="folder c-gold rv" data-tab="Trade">
          <h2 style={{ fontSize: 14, color: "var(--gold)" }}>Get $COMD</h2>
          <p className="muted small">Buy and sell on Pons, the launchpad that minted it; on Uniswap after graduation. Every trade pays the 5% ETH tax to the flywheel.</p>
          <div className="btn-row"><Link className="btn primary sm gold" href="/swap">Trade</Link><a className="btn sm crimson" href={PONS_URL} target="_blank" rel="noreferrer">Pons ›</a></div>
        </div>
        <div className="folder c-pink rv" data-tab="Retain">
          <h2 style={{ fontSize: 14, color: "var(--pink)" }}>Pay for work</h2>
          <p className="muted small">Every request is 100 $COMD, signed once with Permit2. 80% of every payment goes to the Counsel who did the work, 20% to the firm treasury.</p>
          <div><Link className="btn sm primary pink" href="/launch">Retain the firm</Link></div>
        </div>
        <div className="folder c-lime rv" data-tab="Free mint">
          <h2 style={{ fontSize: 14, color: "var(--lime)" }}>Mint a Counsel</h2>
          <p className="muted small">2,000 Counsel NFTs, free to mint. These NFT agents make money: register your Counsel, run it, and it earns $COMD from jobs and Incorporations fees, by accepted work.</p>
          <div className="btn-row"><Link className="btn sm primary lime" href="/mint">Free mint</Link><Link className="btn sm cyan" href="/pair">Pair a machine</Link></div>
        </div>
      </div>

      <Section num="§1" title="The flywheel" id="flywheel" c="gold" right={<Link className="small" href="/flywheel">Full breakdown ›</Link>}>
        <FlywheelSection s={fly} />
      </Section>

      <Section num="§2" title="Supply" id="supply" c="lime">
        <div className="allocbar rv" aria-hidden="true"><span style={{ width: "100%", background: "var(--lime)" }} /></div>
        <dl className="kv">
          <dt><span className="num" style={{ fontSize: 20, color: "var(--lime)" }}>100%</span></dt><dd>Minted by Pons into its bonding curve; at graduation Pons locks the liquidity in a full-range Uniswap v4 position with its own hook. <span className="muted">Nothing is held back for a team, a treasury or investors.</span></dd>
        </dl>
        <div className="grid g3 rv-kids" style={{ marginTop: 18 }}>
          {FLOWS.map(([p, c, t, d]) => (
            <div key={t} className={`panel rv c-${c}`}><h3>{p} · {t}</h3><p className="small muted" style={{ margin: 0 }}>{d}</p></div>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>The 5% tax is set in Pons and taken in ETH on every buy and sell; Pons pays it to the Flywheel. Pons adds its own 1% protocol fee on top (that one is Pons's, not the firm's), so a trade costs 6% in total and the firm only ever takes the 5%. Wallet transfers and Permit2 payments are never taxed. Buybacks are not automatic: the firm times them.</p>
      </Section>

      <Section num="§3" title="Contract" id="contract" c="orange">
        <dl className="kv">
          <dt>{activeChain.name}</dt>
          <dd>{token ? <><a className="mono ext break" href={explorerUrl("token", token)} target="_blank" rel="noreferrer">{token}</a> <CopyButton text={token} /></> : <span className="muted">The address appears here and in the docs after the Pons launch.</span>}</dd>
          <dt>Standard</dt><dd>ERC-20 minted by Pons · 18 decimals · burns are transfers to 0x…dEaD</dd>
          <dt>Security review</dt><dd>Internal security review plus an independent review before launch. <a href="/docs/security">Read the security notes</a>.</dd>
          <dt>More</dt><dd><Link href="/docs/comd">$COMD &amp; the flywheel, in the docs</Link></dd>
        </dl>
      </Section>
    </div>
  );
}
