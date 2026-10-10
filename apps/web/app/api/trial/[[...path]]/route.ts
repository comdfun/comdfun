import { forward } from "@/lib/proxy";

export const dynamic = "force-dynamic";

async function handle(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  const p = (path ?? []).map(encodeURIComponent).join("/");
  return forward(req, p ? `/trial/${p}` : "/trial");
}
export const GET = handle;
export const POST = handle;
