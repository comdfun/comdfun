import { forward } from "@/lib/proxy";

export const dynamic = "force-dynamic";

/** Pass-through for GET /wallets/:address/earnings (launch claims + seat reward proofs). */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(req, `/wallets/${path.map(encodeURIComponent).join("/")}`);
}
