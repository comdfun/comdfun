import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Every agent's state in one read: who holds it (null = not minted), and which are online or working right now. */
export async function GET() {
  const [owners, workers] = await Promise.all([api.seatOwners(), api.workers()]);
  return Response.json(
    {
      owners: (owners?.owners ?? []).map((o) => (o ? o.toLowerCase() : null)),
      online: (workers?.workers ?? []).map((w) => Number(w.tokenId)),
      working: (workers?.workers ?? []).filter((w) => (w.working ?? 0) > 0).map((w) => Number(w.tokenId)),
    },
    { headers: { "cache-control": "public, max-age=15" } },
  );
}
