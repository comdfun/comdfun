import { counselSvg } from "@/lib/art";

// Portraits for mock mode (live mode reads `${API}/agents/by-token/:id.svg`). Deterministic, cache forever.
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const m = /^(\d{1,4})\.svg$/.exec(file);
  const id = m ? Number(m[1]) : 0;
  if (!m || id < 1 || id > 2000) return new Response("not found", { status: 404 }); // Counsel ids are 1..2000
  return new Response(counselSvg(id), {
    headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=31536000, immutable" },
  });
}
