import { getActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** Explorer JSON: GET /api/activity → {at, reachable, workflows, jobs, oracle, working, total} (+ online, acceptedLastDay, health). */
export async function GET() {
  const a = await getActivity();
  return Response.json(a, { headers: { "cache-control": "public, max-age=10" } });
}
