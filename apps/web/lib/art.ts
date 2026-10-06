// Server-side adapter over @company/art (or icons-fallback when the package is absent). Server components render
// SVG strings; client components receive them as props, so the art package never enters the browser bundle.
import * as Pkg from "@company/art";
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

/** Portrait SVG for a token id (used by the /art route in mock mode; live mode reads the API image). */
export function counselSvg(tokenId: number): string {
  const fn = pkg.renderCounsel as ((id: number, o?: { size?: number }) => { svg: string }) | undefined;
  try {
    if (fn) return fn(tokenId, { size: 256 }).svg;
  } catch {}
  return Fallback.renderCounsel(tokenId, { size: 256 }).svg;
}

export const ART_SOURCE = process.env.NEXT_PUBLIC_ART_SOURCE || "fallback";
