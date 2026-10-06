import type { Metadata } from "next";
import { icon, logo } from "@/lib/art";
import { Film } from "@/components/fx/Film";
import { MintFilm } from "@/components/fx/MintFilm";
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
  if (sp.v === "mint") return <MintFilm logo={art.logo} portraits={WALL} mode={mode} />;
  return <Film art={art} mode={mode} />;
}
