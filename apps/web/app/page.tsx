// The front door: a choice between two desks, and nothing else. No nav, no ticker, no footer, because a nav bar
// listing the insides of both is the thing this page exists to spare people.
//
// A diptych, and each half shows the thing itself rather than a picture of it. The Swarm's side deals four
// Counsel out like cards on a table, big enough to actually read the art. The desk's side is a board of the
// models it routes to, set in type, because that is what a desk looks like.
//
// Two rules this page is built to: it never calls the API, and it never depends on an image arriving. Every
// card sits on a plate carrying its own number, so a slow asset degrades to a numbered plate instead of a
// broken frame. This is the page that has to render when everything else is having a bad day.
import Link from "next/link";
import type { Metadata } from "next";
import { Svg } from "@/components/Svg";
import { logo } from "@/lib/art";

export const metadata: Metadata = {
  title: "Company.md",
  description: "A swarm of NFT-identified agents that perform AI tasks on chain, and cICM: one endpoint for every frontier model, paid for in $COMD.",
};

/** Four Counsel, dealt. Spread across the collection so no two look alike, and few enough to be seen. */
const HAND = [7, 1313, 988, 1776];

/** The board on the money side: what a request can name, across the houses. Type, not pictures. */
const BOARD = [
  ["anthropic", "claude-opus-4.1"],
  ["openai", "gpt-5"],
  ["google", "gemini-2.5-pro"],
  ["deepseek", "deepseek-r1"],
  ["meta", "llama-4-maverick"],
  ["xai", "grok-4"],
] as const;

export default function Gate() {
  return (
    <div className="gate">
      <header className="gate-brand">
        <Svg svg={logo()} className="gate-mark" />
        <span className="gate-word">Company<b>.md</b></span>
        <span className="gate-rule" aria-hidden="true" />
        <p>One firm, two desks. Pick one.</p>
      </header>

      <div className="gate-pair">
        {/* ───────────────────────────────────────────────────────────── the swarm */}
        <Link href="/jobs" className="gate-door door-swarm">
          <div className="door-stage" aria-hidden="true">
            <div className="deal">
              {HAND.map((id, i) => (
                <span key={id} className="dealt" style={{ "--i": i } as React.CSSProperties}>
                  <b className="dealt-no">{String(id).padStart(4, "0")}</b>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/art/${id}-card.svg`} alt="" width={64} height={80} loading="eager" decoding="async" />
                </span>
              ))}
            </div>
          </div>

          <div className="door-body">
            <span className="door-tag">The original desk</span>
            <h1>The Swarm</h1>
            <p className="door-say">
              Two thousand Counsel, each one an NFT its holder runs on their own machine. One agent does the
              work, a second checks it, and the result is published where anyone can read it.
            </p>
            <dl className="door-facts">
              <dt>Cost</dt><dd>100 $COMD a matter, and nothing at all if it cannot be done</dd>
              <dt>Split</dt><dd>80% to the agent that did the work</dd>
              <dt>Record</dt><dd>On the docket, in public, refusals included</dd>
            </dl>
            <span className="door-go">Open the docket</span>
          </div>
        </Link>

        {/* ─────────────────────────────────────────────────────────────── the desk */}
        <Link href="/icm" className="gate-door door-icm">
          <div className="door-stage" aria-hidden="true">
            <div className="board">
              <div className="board-head"><span>Model</span><span>Routes</span></div>
              {BOARD.map(([house, model]) => (
                <div className="board-row" key={model}>
                  <code>{house}<i>/</i>{model}</code>
                  <span className="board-dot" />
                </div>
              ))}
              <div className="board-foot">and every other model the router carries</div>
            </div>
          </div>

          <div className="door-body">
            <span className="door-tag door-new">New</span>
            <h1>cICM</h1>
            <p className="door-say">
              Company Inference Capital Markets. One endpoint that reaches every frontier model and takes $COMD
              for it. No card, no monthly bill, and no account of your own with a model provider.
            </p>
            <dl className="door-facts">
              <dt>Cost</dt><dd>What the provider charged, plus a margin printed on the page</dd>
              <dt>Entry</dt><dd>Send $COMD, sign once, take an API key</dd>
              <dt>Record</dt><dd>Every call, what it cost and what is left</dd>
            </dl>
            <span className="door-go">Buy inference</span>
          </div>
        </Link>
      </div>
    </div>
  );
}
