import { forward } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** cICM, proxied through the site so a browser never needs the API's origin or a CORS exception. The inference
 *  endpoint itself is not meant to be called from here — a program points at api.comd.fun/icm/v1 directly — but
 *  the rate card, the account view and key management all come through this. */
async function handle(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  const p = (path ?? []).map(encodeURIComponent).join("/");
  return forward(req, p ? `/icm/${p}` : "/icm");
}
export const GET = handle;
export const POST = handle;
