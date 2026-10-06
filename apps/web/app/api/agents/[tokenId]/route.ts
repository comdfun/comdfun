import { api } from "@/lib/api";
import { forward } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** Explorer JSON: GET /api/agents/:tokenId; also passes through /agents/register-intent and POST /agents/bind. */
export async function GET(req: Request, ctx: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await ctx.params;
  if (tokenId === "register-intent") return forward(req, "/agents/register-intent");
  if (!/^\d+$/.test(tokenId)) return new Response(null, { status: 404 });
  const [seat, names] = await Promise.all([api.seat(tokenId, 200), api.names()]);
  if (!seat) return new Response(null, { status: 404 });
  const ownerName = names?.names.find((n) => n.address?.toLowerCase() === seat.owner?.toLowerCase())?.name ?? null;
  const accepted = seat.work.filter((w) => w.status === "accepted");
  return Response.json({
    tokenId: seat.tokenId,
    online: seat.online,
    owner: seat.owner,
    ownerName,
    held: !!seat.owner,
    attempts: seat.attempts,
    accepted: seat.accepted,
    jobs: new Set(seat.work.map((w) => w.jobId)).size,
    lastAcceptedAt: accepted[0]?.acceptedAt ?? null,
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await ctx.params;
  if (tokenId === "bind") return forward(req, "/agents/bind");
  return Response.json({ error: "unknown_route" }, { status: 404 });
}
