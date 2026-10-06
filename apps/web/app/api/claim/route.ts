import { get } from "@/lib/api";

export const dynamic = "force-dynamic";

type Claim = { root: string; amount: string; proof: string[]; launchNumber?: number; unlockAt?: number | string | null };
type Legacy = { claims?: { root: string; leaves: { wallet: string; amount: string; proof: string[] }[] } };

/**
 * Explorer JSON: GET /api/claim?launch=&wallet= → {claim:{root, amount, proof, launchNumber, unlockAt}} | {claim:null}.
 * Reads the control plane's own /api/claim (frozen contributor tree); falls back to /launches/:id?claims=1.
 * `launchNumber` is the on-chain launchId for ContributorDistributor.claim/unlockAt.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const launch = u.searchParams.get("launch") ?? "";
  const wallet = (u.searchParams.get("wallet") ?? "").toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(launch) || !/^0x[0-9a-f]{40}$/.test(wallet)) return Response.json({ error: "invalid_request" }, { status: 400 });
  const direct = await get<{ claim: Claim | null }>(`/api/claim?launch=${launch}&wallet=${wallet}`, { revalidate: false });
  if (direct && "claim" in direct) return Response.json({ claim: direct.claim });
  const l = await get<Legacy>(`/launches/${launch}?claims=1`);
  const leaf = l?.claims?.leaves.find((x) => x.wallet.toLowerCase() === wallet);
  return Response.json({ claim: leaf && l?.claims ? { root: l.claims.root, amount: leaf.amount, proof: leaf.proof } : null });
}
