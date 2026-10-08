// Server-side adapter over @company/art (or icons-fallback when the package is absent). Server components render
// SVG strings; client components receive them as props, so the art package never enters the browser bundle.
// the real generator lives in the workspace package; the subpath entry is browser-safe (no node:zlib)
import * as Pkg from "@company/art/svg";
import * as Fallback from "./icons-fallback";

type AnyFn = (...a: unknown[]) => unknown;
const pkg = Pkg as unknown as Record<string, unknown>;

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "function") {
    try {
      const out = (v as AnyFn)();
      return typeof out === "string" ? out : undefined;
    } catch {
      return undefined;
    }
  }
  if (v && typeof v === "object" && typeof (v as { svg?: unknown }).svg === "string") return (v as { svg: string }).svg;
  return undefined;
}

/** Force a 16×16 icon to scale with CSS and tint via currentColor where the source allows. */
function normalize(svg: string) {
  return svg
    .replace(/<\?xml[^>]*>/, "")
    .replace(/\swidth="[^"]*"/, "")
    .replace(/\sheight="[^"]*"/, "")
    .replace("<svg", '<svg aria-hidden="true" focusable="false"');
}

export function icon(name: string): string {
  const fromPkg = asString((pkg.icons as Record<string, unknown> | undefined)?.[name]);
  const svg = fromPkg ?? Fallback.icons[name] ?? Fallback.icons.document;
  return normalize(svg);
}

export function iconSet(names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((n) => [n, icon(n)]));
}

function callSvg(name: string, opts: Record<string, unknown>): string | undefined {
  const fn = pkg[name];
  if (typeof fn !== "function") return undefined;
  try {
    const out = (fn as AnyFn)(opts);
    return typeof out === "string" ? out : undefined;
  } catch {
    return undefined;
  }
}

export function logo(): string {
  return normalize(callSvg("logoSvg", { size: 32, background: null, color: "#FFC83D" }) ?? Fallback.logoSvg());
}

export function wordmark(): string {
  return normalize(callSvg("wordmarkSvg", { height: 16, color: "currentColor" }) ?? Fallback.wordmarkSvg());
}

/** The 32×32 Counsel portrait (the square crop of the token art). */
export function counselSvg(tokenId: number): string {
  const fn = pkg.renderCounsel as ((id: number, o?: { size?: number }) => { svg: string }) | undefined;
  try {
    if (fn) return fn(tokenId, { size: 256 }).svg;
  } catch {}
  return Fallback.renderCounsel(tokenId, { size: 256 }).svg;
}

/** The 64×80 bar card — the image the NFT's metadata points at, nameplate and all. Falls back to the portrait. */
export function counselCardSvg(tokenId: number): string {
  const fn = pkg.renderCard as ((id: number, o?: { width?: number }) => { svg: string }) | undefined;
  try {
    if (fn) return fn(tokenId, { width: 256 }).svg;
  } catch {}
  return counselSvg(tokenId);
}

export const ART_SOURCE = process.env.NEXT_PUBLIC_ART_SOURCE || "fallback";
