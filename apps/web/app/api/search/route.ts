import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Explorer JSON: GET /api/search?q=&part= → {groups:[{key,label,hits}]} */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").slice(0, 200).trim();
  const part = u.searchParams.get("part");
  if (!q) return Response.json({ groups: [] });
  const want = (k: string) => !part || part === k;
  const [jobs, oracle, pubs] = await Promise.all([
    want("jobs") ? api.jobs({ q, limit: 8 }) : null,
    want("oracle") ? api.oracleRequests({ q, limit: 8 }) : null,
    want("published") ? api.publications({ q, pageSize: 8 }) : null,
  ]);
  const groups = [
    jobs && { key: "jobs", label: "Matters", hits: jobs.jobs.map((j) => ({ id: j.id, title: j.objective.slice(0, 140), url: `/jobs/${j.id}`, at: j.createdAt })) },
    oracle && { key: "oracle", label: "Rulings", hits: oracle.requests.map((o) => ({ id: o.id, title: o.question.slice(0, 140), url: `/oracle/${o.id}`, at: o.createdAt })) },
    pubs && { key: "published", label: "Filings", hits: pubs.items.map((p) => ({ id: p.id, title: p.title, url: `/jobs/${p.id.replace(/^job:/, "")}`, at: p.publishedAt })) },
  ].filter(Boolean);
  return Response.json({ groups });
}
