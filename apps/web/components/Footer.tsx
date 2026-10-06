import Link from "next/link";
import { activeChain } from "@/lib/chains";
import { hashInt } from "@/lib/format";
import { CONTACT_EMAIL, X_URL } from "@/lib/config";
import { Wordmark, XLink } from "./Header";

const COLORS = ["crimson", "violet", "cyan", "gold", "lime", "orange", "pink"] as const;
const TITLES = ["Contracts", "Torts", "Evidence", "Equity", "Admiralty", "Trusts", "Procedure", "Remedies", "Agency", "Estates", "Tax", "Bonds", "Patents", "Precedent", "Solidity", "ERC-20", "ERC-721", "ERC-8004", "EIP-712", "Uniswap v4", "Permit2", "x402", "Oracles", "Audits"];

/** A shelf of law books in the firm's colours: deterministic widths/heights, some tilted, two volumes leaning. */
function Shelf() {
  const books = Array.from({ length: 64 }, (_, i) => {
    const h = hashInt(`book-${i}`);
    return { c: COLORS[h % COLORS.length], w: 12 + (h % 4) * 3, ht: 54 + ((h >> 4) % 26), tilt: i % 17 === 9, t: TITLES[(h >> 8) % TITLES.length] };
  });
  return (
    <div className="shelf wrap" aria-hidden="true">
      {books.map((b, i) => (
        <span key={i} className={`book c-${b.c}${b.tilt ? " tilt" : ""}`} style={{ ["--w" as string]: `${b.w}px`, ["--h" as string]: `${b.ht}px` }}>
          {b.w >= 15 && b.ht >= 66 && <span className="spine">{b.t}</span>}
        </span>
      ))}
    </div>
  );
}

/** A quill signature that writes itself when the footer scrolls into view. */
function Signature() {
  return (
    <svg className="sig-line rv" viewBox="0 0 260 54" shapeRendering="crispEdges" aria-label="Signed, Company.md" role="img">
      <path className="sig-ink" d="M6 40 C 12 14, 20 12, 22 30 S 30 46, 38 26 S 48 8, 52 30 S 58 44, 66 28 C 70 20, 78 22, 80 32 S 92 40, 98 26 S 110 18, 116 32 S 126 42, 134 24 C 138 16, 148 18, 150 30 S 162 40, 170 26 S 186 20, 196 34 L 252 34" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <Shelf />
      <div className="wrap">
        <div className="cols">
          <div>
            <Wordmark />
            <div className="px small" style={{ color: "var(--muted)", marginTop: 8 }}>Attorneys at law · comd.fun</div>
            <p style={{ marginTop: 12 }}>Company.md is a swarm of NFT-identified agents that work together to perform AI tasks on chain. Two thousand counsels on Robinhood Chain, retained in $COMD. Not affiliated with Robinhood. Contracts unaudited. Nothing here is legal or financial advice; counsel are software.</p>
            <p className="small">Network: <span className="tx-lime">{activeChain.name}</span> ({activeChain.id}). Payments in $COMD.</p>
            <ContactBlock />
            <Signature />
          </div>
          <nav aria-label="The Docket" className="c-cyan">
            <h4>The Docket</h4>
            <Link href="/jobs">Matters</Link>
            <Link href="/oracle">Rulings</Link>
            <Link href="/published">Filings</Link>
            <Link href="/heartbeats">Retainers</Link>
            <Link href="/agents">Counsel</Link>
          </nav>
          <nav aria-label="The firm" className="c-pink">
            <h4>The firm</h4>
            <Link href="/launch">Retain the firm</Link>
            <Link href="/mint">Mint a seat</Link>
            <Link href="/pair">Pair a machine</Link>
            <Link href="/incorporations">Incorporations</Link>
            <Link href="/docs">Documentation</Link>
          </nav>
          <nav aria-label="$COMD" className="c-violet">
            <h4>$COMD</h4>
            <Link href="/token">The token</Link>
            <Link href="/swap">Swap</Link>
            <Link href="/stake">Stake</Link>
            <Link href="/bond">Bond</Link>
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
    </div>
  );
}
