import Link from "next/link";
import { logo } from "@/lib/art";
import { Svg } from "./Svg";
import { NavLinks } from "./NavLinks";
import { ConnectButton } from "./ConnectButton";
import { X_URL, X_HANDLE } from "@/lib/config";

export const NAV = [
  { href: "/jobs", label: "Docket", c: "cyan", match: ["/jobs", "/oracle", "/published", "/heartbeats", "/agents", "/launches"] },
  { href: "/launch", label: "Retain", c: "pink", match: ["/launch"] },
  { href: "/token", label: "$COMD", c: "gold", match: ["/token"] },
  { href: "/swap", label: "Vault", c: "violet", match: ["/swap", "/stake", "/bond", "/flywheel"], sub: [{ href: "/swap", label: "Swap" }, { href: "/stake", label: "Stake" }, { href: "/bond", label: "Bond" }, { href: "/flywheel", label: "Flywheel" }] },
  { href: "/incorporations", label: "Coins", c: "lime", match: ["/incorporations"] },
  { href: "/mint", label: "Mint", c: "lime", match: ["/mint", "/pair"] },
  { href: "/docs", label: "Docs", c: "orange", match: ["/docs"] },
];

/** "COMPANY.MD" set in the pixel display face; the .MD is the accent. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`} aria-label="Company.md">
      <span aria-hidden="true">COMPANY<span className="md">.MD</span></span>
    </span>
  );
}

export function Header() {
  return (
    <header className="site-header">
      <div className="wrap bar">
        <Link href="/" className="brand" aria-label="Company.md, home">
          <Svg svg={logo()} className="logo" />
          <span>
            <Wordmark className="wm" />
            <span className="est">Attorneys at law · comd.fun</span>
          </span>
        </Link>
        <NavLinks items={NAV} />
        <div className="connect">
          <XLink className="hdr-x" />
          <ConnectButton className="btn sm primary" />
        </div>
      </div>
    </header>
  );
}

/** The firm on X: a pixel "X" glyph (7×7) plus the handle where there is room. */
export function XLink({ className = "", label = false }: { className?: string; label?: boolean }) {
  const px = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [6, 0], [5, 1], [4, 2], [2, 4], [1, 5], [0, 6], [1, 0], [5, 6]];
  return (
    <a className={`xlink ${className}`} href={X_URL} target="_blank" rel="noreferrer" aria-label={`Company.md on X (${X_HANDLE})`} title={`${X_HANDLE} on X`}>
      <svg viewBox="0 0 7 7" width="14" height="14" shapeRendering="crispEdges" aria-hidden="true">
        {px.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />)}
      </svg>
      {label && <span>{X_HANDLE}</span>}
    </a>
  );
}
