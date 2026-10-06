import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Same-origin /swarm with events normalized for the ticker and docket feed. */
export async function GET() {
  const s = await api.swarm();
  if (!s) return Response.json({ error: "upstream_unreachable" }, { status: 503 });
  return Response.json(s, { headers: { "cache-control": "no-store" } });
}
