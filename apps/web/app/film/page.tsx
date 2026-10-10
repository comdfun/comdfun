import type { Metadata } from "next";
import { icon, logo } from "@/lib/art";
import { Film } from "@/components/fx/Film";
import { MintFilm } from "@/components/fx/MintFilm";
import { AnnounceFilm } from "@/components/fx/AnnounceFilm";
import "./film.css";

export const metadata: Metadata = {
  title: "Company.md — the film",
  description: "What Company.md is, in 69 seconds: a swarm of NFT-identified agents that work together to perform AI tasks on chain.",
  robots: { index: false, follow: false },
};

const PORTRAITS = [7, 42, 256, 777, 1234, 1776, 1999, 133];
// a wall of 42 distinct Counsel for the "Mint live" announcement
const WALL = [7, 42, 133, 256, 404, 512, 777, 1001, 1234, 1500, 1776, 1999, 12, 1, 26, 6, 3, 21, 99, 2, 31, 150, 9, 64, 88, 111, 222, 333, 444, 555, 666, 888, 999, 1111, 1313, 1414, 1515, 1616, 1717, 1818, 1919, 2000];

/** The explainer film, full-frame. Rendered to MP4 by scripts/film.mjs (?manual=1); ?still=1 freezes on the title. */
export default async function FilmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const art = { logo: logo(), icons: { scales: icon("scales"), chain: icon("chain"), gavel: icon("gavel"), coin: icon("coin"), seal: icon("seal") }, portraits: PORTRAITS };
  const mode = sp.still === "1" ? "still" : sp.manual === "1" ? "manual" : "auto";
  // the pixel faces load on page load (off-screen, real glyphs) so document.fonts.ready is honest for the renderer
  const preload = (
    <div className="film-fontload" aria-hidden="true">
      {['"Press Start 2P"', '"Silkscreen"', '"Pixelify Sans"', '"VT323"'].map((f) => (
        <span key={f} style={{ fontFamily: f }}>0123ABCabc</span>
      ))}
    </div>
  );
  if (sp.v === "mint") return <>{preload}<MintFilm logo={art.logo} portraits={WALL} mode={mode} /></>;
  if (sp.v === "minted" || sp.v === "comd" || sp.v === "register" || sp.v === "tasks" || sp.v === "steps" || sp.v === "build" || sp.v === "imd" || sp.v === "fomo" || sp.v === "wheel" || sp.v === "dev" || sp.v === "gm" || sp.v === "burn" || sp.v === "backend" || sp.v === "receipt" || sp.v === "working" || sp.v === "major" || sp.v === "burn2" || sp.v === "traits" || sp.v === "trades" || sp.v === "fwtrack" || sp.v === "versus" || sp.v === "pushed" || sp.v === "burn3" || sp.v === "burn4" || sp.v === "burn5" || sp.v === "burn6" || sp.v === "burn7" || sp.v === "burn8" || sp.v === "burn9" || sp.v === "contest" || sp.v === "today" || sp.v === "matters" || sp.v === "agentfi" || sp.v === "activity" || sp.v === "oracle" || sp.v === "coins" || sp.v === "clerk" || sp.v === "x402" || sp.v === "upgrade" || sp.v === "hack" || sp.v === "soon" || sp.v === "burn10" || sp.v === "state" || sp.v === "found" || sp.v === "retain" || sp.v === "bench" || sp.v === "epochs" || sp.v === "flow" || sp.v === "filed" || sp.v === "wallet" || sp.v === "gate" || sp.v === "screen" || sp.v === "watch" || sp.v === "holders" || sp.v === "proof") return <>{preload}<AnnounceFilm kind={sp.v} logo={art.logo} portraits={WALL} mode={mode} /></>;
  return <>{preload}<Film art={art} mode={mode} /></>;
}
