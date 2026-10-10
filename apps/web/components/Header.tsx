import Link from "next/link";
import { logo } from "@/lib/art";
import { Svg } from "./Svg";
import { NavLinks } from "./NavLinks";
import { ConnectButton } from "./ConnectButton";
import { OpenSeaLink } from "./OpenSeaLink";
import { XLink } from "./XLink";
import { GitHubLink } from "./GitHubLink";
import { WhatIsThisLink } from "./WhatIsThisLink";

export { XLink };

export const NAV = [
  { href: "/jobs", label: "Docket", c: "cyan", match: ["/jobs", "/oracle", "/published", "/heartbeats", "/agents", "/launches", "/today"], hint: "Matters · Rulings · Filings · Counsel" },
  { href: "/launch", label: "Retain", c: "pink", match: ["/launch"], hint: "Pay the firm in $COMD" },
  { href: "/token", label: "$COMD", c: "gold", match: ["/token"], hint: "The token" },
  { href: "/swap", label: "Treasury", c: "violet", match: ["/swap", "/flywheel"], sub: [{ href: "/swap", label: "Trade", hint: "Pons · Uniswap" }, { href: "/flywheel", label: "Flywheel", hint: "Burns · floor sweeps" }] },
  { href: "/incorporations", label: "Coins", c: "lime", match: ["/incorporations"], hint: "Company coins in $COMD" },
  { href: "/me", label: "My Counsel", c: "lime", match: ["/me", "/mint", "/pair"], hint: "Your seats · register · earn" },
  { href: "/room", label: "Holders Room", c: "pink", match: ["/room"], hint: "Chat · submit promotion · earn $COMD" },
  { href: "/docs", label: "Docs", c: "orange", match: ["/docs"], hint: "Guides and the API" },
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
            <span className="est">NFT-Identified Swarm · comd.fun</span>
          </span>
        </Link>
        <NavLinks items={NAV} />
        <div className="connect">
          <WhatIsThisLink className="hdr-what" />
          <XLink className="hdr-x" />
          <GitHubLink className="hdr-x hdr-gh" />
          <OpenSeaLink className="hdr-x hdr-os" />
          <ConnectButton className="btn sm primary" />
        </div>
      </div>
    </header>
  );
}
