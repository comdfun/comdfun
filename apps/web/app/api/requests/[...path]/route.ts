import { forward } from "@/lib/proxy";

export const dynamic = "force-dynamic";

const ALLOWED = /^(capabilities|check|import|quote|[0-9a-f-]{8,64}(\/submit)?|paid-by\/0x[0-9a-fA-F]{40})$/;

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const p = path.join("/");
  if (!ALLOWED.test(p)) return Response.json({ error: "unknown_route" }, { status: 404 });
  return forward(req, `/requests/${p}`);
}
export const GET = handle;
export const POST = handle;
