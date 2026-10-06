import { introSceneSvg } from "@/lib/intro-scene";

export const dynamic = "force-static";

/** The intro's office-floor scene: generated once at build time, cached forever. */
export function GET() {
  return new Response(introSceneSvg(), { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=31536000, immutable" } });
}
