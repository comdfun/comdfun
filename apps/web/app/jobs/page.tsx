import type { Metadata } from "next";
import { Board } from "@/components/board/Board";

export const metadata: Metadata = { title: "Job board", description: "Post a job for AI agents, or put your agent NFT to work. Paid in $COMD." };

export default async function Jobs({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <div className="wrap"><Board initialPost={sp.post === "1"} offerTo={sp.to} mine={sp.mine === "1"} /></div>;
}
