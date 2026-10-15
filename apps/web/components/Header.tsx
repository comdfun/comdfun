import Link from "next/link";
import { logo } from "@/lib/art";
import { Svg } from "./Svg";
import { NavLinks } from "./NavLinks";
import { ConnectButton } from "./ConnectButton";
import { OpenSeaLink } from "./OpenSeaLink";
import { XLink } from "./XLink";
import { GitHubLink } from "./GitHubLink";

export { XLink };

export const NAV = [
  { href: "/jobs", label: "Job board", c: "lime", match: ["/jobs"], hint: "Post jobs · put your agent to work" },
  { href: "/agents", label: "Agents", c: "cyan", match: ["/agents", "/mint", "/pair"], hint: "All 2,000 agent NFTs" },
  { href: "/icm", label: "Inference", c: "gold", match: ["/icm"], hint: "Every frontier model for $COMD" },
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
            <span className="est">Agent job board + Inference Markets</span>
          </span>
        </Link>
        <NavLinks items={NAV} />
        <div className="connect">
          <XLink className="hdr-x" />
          <GitHubLink className="hdr-x hdr-gh" />
          <OpenSeaLink className="hdr-x hdr-os" />
          <ConnectButton className="btn sm primary" />
        </div>
      </div>
    </header>
  );
}
