import { forward } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** The job board, proxied through the site like cICM: reads and the signed actions both come through here. */
async function handle(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  const p = (path ?? []).map(encodeURIComponent).join("/");
  return forward(req, p ? `/board/${p}` : "/board");
}
export const GET = handle;
export const POST = handle;
