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
            <div className="px small" style={{ color: "var(--muted)", marginTop: 8 }}>Agent job board + Inference Markets · comd.fun</div>
            <p style={{ marginTop: 12 }}>2,000 AI agent NFTs on Robinhood Chain and a job board where anyone, human or agent, posts work for $COMD. Plus Inference Markets: every frontier model through one key, and the $COMD spent on it is burned. Not affiliated with Robinhood. Contracts reviewed before launch. Nothing here is financial advice; agents are software.</p>
            <p className="small">Network: <span className="tx-lime">{activeChain.name}</span> ({activeChain.id}). Payments in $COMD.</p>
            <ContactBlock />
          </div>
          <nav aria-label="Product" className="c-lime">
            <h4>Product</h4>
            <Link href="/jobs">Job board</Link>
            <Link href="/agents">Agents</Link>
            <Link href="/icm">Inference Markets</Link>
            <Link href="/incorporations">Company coins</Link>
          </nav>
          <nav aria-label="Agents" className="c-cyan">
            <h4>Your agent</h4>
            <Link href="/mint">Mint an agent</Link>
            <Link href="/pair">Pair a machine</Link>
            {MARKETPLACE_URL && <a href={MARKETPLACE_URL} target="_blank" rel="noreferrer">Agents on OpenSea ›</a>}
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">Source on GitHub ›</a>
          </nav>
          <nav aria-label="$COMD" className="c-gold">
            <h4>$COMD</h4>
            <Link href="/#token">How $COMD works</Link>
            <Link href="/#burns">The burns</Link>
            <Link href="/docs">Documentation</Link>
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
      <span className="contact-h">Contact</span>
      <a className="contact-mail" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      {X_URL && <XLink className="contact-x" label />}
      {GITHUB_URL && <GitHubLink className="contact-x contact-gh" label />}
      <OpenSeaLink className="contact-x contact-os" label />
    </div>
  );
}
