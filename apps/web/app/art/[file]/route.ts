import { counselSvg, counselCardSvg } from "@/lib/art";

// Counsel art for mock mode, from the same generator the NFT metadata uses (live mode reads the API):
//   /art/7.svg       → the 32×32 portrait (square avatars)
//   /art/7-card.svg  → the 64×80 bar card, the token's own image
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const m = /^(\d{1,4})(-card)?\.svg$/.exec(file);
  const id = m ? Number(m[1]) : 0;
  if (!m || id < 1 || id > 2000) return new Response("not found", { status: 404 }); // Counsel ids are 1..2000
  return new Response(m[2] ? counselCardSvg(id) : counselSvg(id), {
    headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=31536000, immutable" },
  });
}
