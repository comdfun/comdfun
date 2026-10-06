import { MARKETPLACE_URL } from "@/lib/config";

/** A 9×9 pixel ship's wheel / sail glyph for the marketplace link (NEXT_PUBLIC_MARKETPLACE_URL, default: the Counsel collection on OpenSea). */
const SAIL: [number, number][] = [
  [4, 0], [4, 1], [3, 2], [4, 2], [5, 2], [2, 3], [4, 3], [6, 3], [1, 4], [2, 4], [4, 4], [6, 4], [7, 4],
  [1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [0, 6], [8, 6], [1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7], [2, 8], [6, 8],
];

export function OpenSeaLink({ className = "", label = false, text = "OpenSea" }: { className?: string; label?: boolean; text?: string }) {
  if (!MARKETPLACE_URL) return null;
  return (
    <a className={`xlink oslink ${className}`} href={MARKETPLACE_URL} target="_blank" rel="noreferrer" aria-label="The Counsel collection on OpenSea" title="Counsel on OpenSea">
      <svg viewBox="0 0 9 9" width="16" height="16" shapeRendering="crispEdges" aria-hidden="true">
        {SAIL.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />)}
      </svg>
      {label && <span>{text}</span>}
    </a>
  );
}
