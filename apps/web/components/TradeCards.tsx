import { XLink } from "./Header";

/** Where to trade $COMD: Pons (launch + bonding curve) and, after graduation, Uniswap. Links are env-driven. */
export function TradeCards({ ponsUrl, uniswapUrl, graduated }: { ponsUrl: string; uniswapUrl: string; graduated: boolean }) {
  const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };
  return (
    <div className="stack">
      <a className="folder c-gold trade-card rv" data-tab="Trade on Pons" href={ponsUrl} target="_blank" rel="noreferrer">
        <span className="trade-mark" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="48" height="48" shapeRendering="crispEdges">
            <rect x="2" y="2" width="12" height="12" fill="#ffc83d" /><rect x="4" y="4" width="8" height="8" fill="#000" />
            <rect x="5" y="5" width="2" height="6" fill="#ffc83d" /><rect x="7" y="5" width="3" height="1" fill="#ffc83d" /><rect x="9" y="6" width="1" height="2" fill="#ffc83d" /><rect x="7" y="8" width="3" height="1" fill="#ffc83d" />
          </svg>
        </span>
        <span className="trade-body">
          <b>Buy &amp; sell $COMD on Pons</b>
          <span>The launchpad that minted $COMD. Trade on the bonding curve until graduation; the 5% tax goes to the Flywheel either way.</span>
          <span className="trade-go">{host(ponsUrl)} ›</span>
        </span>
      </a>
      {uniswapUrl ? (
        <a className="folder c-pink trade-card rv" data-tab="Graduated · Uniswap" href={uniswapUrl} target="_blank" rel="noreferrer">
          <span className="trade-mark" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="48" height="48" shapeRendering="crispEdges">
              <rect x="2" y="2" width="12" height="12" fill="#ff4fa3" /><rect x="4" y="4" width="8" height="8" fill="#000" />
              <rect x="5" y="5" width="2" height="5" fill="#ff4fa3" /><rect x="9" y="5" width="2" height="5" fill="#ff4fa3" /><rect x="5" y="10" width="6" height="1" fill="#ff4fa3" />
            </svg>
          </span>
          <span className="trade-body">
            <b>Trade on Uniswap</b>
            <span>$COMD has graduated: liquidity is locked by Pons in a full-range Uniswap v4 pool.</span>
            <span className="trade-go">{host(uniswapUrl)} ›</span>
          </span>
        </a>
      ) : (
        <div className="panel c-pink rv">
          <h3>After graduation</h3>
          <p className="small muted" style={{ margin: 0 }}>{graduated ? "The pool is live; the Uniswap link appears here as soon as it is published." : "When $COMD graduates on Pons, its liquidity moves to a locked Uniswap v4 pool and a Uniswap trade link appears here. Buybacks start then too."}</p>
        </div>
      )}
      <p className="small muted rv">Announcements, including graduation, go out on <XLink label /></p>
    </div>
  );
}
