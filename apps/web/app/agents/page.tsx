import type { Metadata } from "next";
import { traitTable, PRACTICES } from "@company/art/svg";
import { api } from "@/lib/api";
import { Collection } from "@/components/agents/Collection";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agents", description: "All 2,000 AI agent NFTs, live from Robinhood Chain: in colour when online, grey when idle, faded until minted." };

export default async function Agents({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [owners, workers] = await Promise.all([api.seatOwners(), api.workers()]);
  // one digit per token: its practice, the trait the filter offers (index into PRACTICES)
  const practice = traitTable().map((t) => PRACTICES.indexOf(t.practice)).join("");
  return (
    <div className="wrap">
      <Collection
        owners={(owners?.owners ?? []).map((o) => (o ? o.toLowerCase() : null))}
        online={(workers?.workers ?? []).map((w) => Number(w.tokenId))}
        working={(workers?.workers ?? []).filter((w) => (w.working ?? 0) > 0).map((w) => Number(w.tokenId))}
        practice={practice}
        practices={[...PRACTICES]}
        mine={sp.mine === "1"}
      />
    </div>
  );
}
