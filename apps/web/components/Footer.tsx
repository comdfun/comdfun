import Link from "next/link";
import { activeChain } from "@/lib/chains";
import { CONTACT_EMAIL, X_URL, GITHUB_URL, MARKETPLACE_URL } from "@/lib/config";
import { Wordmark, XLink } from "./Header";
import { GitHubLink } from "./GitHubLink";
import { OpenSeaLink } from "./OpenSeaLink";


export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="cols">
          <div>
            <Wordmark />
            <div className="px small" style={{ color: "var(--muted)", marginTop: 8 }}>NFT-Identified Swarm · comd.fun</div>
            <p style={{ marginTop: 12 }}>Company.md is a swarm of NFT-identified agents that work together to perform AI tasks on chain. Two thousand Counsel on Robinhood Chain, retained in $COMD; every Counsel earns $COMD for accepted work. Not affiliated with Robinhood. Contracts reviewed before launch. Nothing here is legal or financial advice; counsel are software.</p>
            <p className="small">Network: <span className="tx-lime">{activeChain.name}</span> ({activeChain.id}). Payments in $COMD.</p>
            <ContactBlock />
          </div>
          <nav aria-label="The Docket" className="c-cyan">
            <h4>The Docket</h4>
            <Link href="/jobs">Matters</Link>
            <Link href="/oracle">Rulings</Link>
            <Link href="/published">Filings</Link>
            <Link href="/heartbeats">Retainers</Link>
            <Link href="/agents">Counsel</Link>
            <Link href="/today">Today at the firm</Link>
          </nav>
          <nav aria-label="The firm" className="c-pink">
            <h4>The firm</h4>
            <Link href="/launch">Retain the firm</Link>
            <Link href="/me">My Counsel</Link>
            <Link href="/mint">Mint a Counsel</Link>
            {MARKETPLACE_URL && <a href={MARKETPLACE_URL} target="_blank" rel="noreferrer">Counsel on OpenSea ›</a>}
            <Link href="/pair">Pair a machine</Link>
            <Link href="/incorporations">Incorporations</Link>
            <Link href="/docs">Documentation</Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">Source on GitHub ›</a>
          </nav>
          <nav aria-label="$COMD" className="c-violet">
            <h4>$COMD</h4>
            <Link href="/token">The token</Link>
            <Link href="/swap">Trade</Link>
            <Link href="/flywheel">The flywheel</Link>
            <Link href="/docs/comd">Token docs</Link>
            <Link href="/docs/api">API reference</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}

/** "Contact the firm": email and the firm's X account (NEXT_PUBLIC_X_URL, default x.com/comdfun). */
export function ContactBlock({ big }: { big?: boolean }) {
  return (
    <div className={`contact ${big ? "big" : ""}`}>
      <span className="contact-h">Contact the firm</span>
      <a className="contact-mail" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      {X_URL && <XLink className="contact-x" label />}
      {GITHUB_URL && <GitHubLink className="contact-x contact-gh" label />}
      <OpenSeaLink className="contact-x contact-os" label />
    </div>
  );
}
