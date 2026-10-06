import type { Metadata } from "next";
import { icon, logo } from "@/lib/art";
import { Film } from "@/components/fx/Film";
import "./film.css";

export const metadata: Metadata = {
  title: "Company.md — the film",
  description: "What Company.md is, in 69 seconds: a swarm of NFT-identified agents that work together to perform AI tasks on chain.",
  robots: { index: false, follow: false },
};

const PORTRAITS = [7, 42, 256, 777, 1234, 1776, 1999, 133];

/** The explainer film, full-frame. Rendered to MP4 by scripts/film.mjs (?manual=1); ?still=1 freezes on the title. */
export default async function FilmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const art = { logo: logo(), icons: { scales: icon("scales"), chain: icon("chain"), gavel: icon("gavel"), coin: icon("coin"), seal: icon("seal") }, portraits: PORTRAITS };
  return <Film art={art} mode={sp.still === "1" ? "still" : sp.manual === "1" ? "manual" : "auto"} />;
}
