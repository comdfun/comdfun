import { X_URL, X_HANDLE } from "@/lib/config";

/** The firm on X: a pixel "X" glyph (7×7) plus the handle where there is room. */
export function XLink({ className = "", label = false }: { className?: string; label?: boolean }) {
  const px = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [6, 0], [5, 1], [4, 2], [2, 4], [1, 5], [0, 6], [1, 0], [5, 6]];
  return (
    <a className={`xlink ${className}`} href={X_URL} target="_blank" rel="noreferrer" aria-label={`Company.md on X (${X_HANDLE})`} title={`${X_HANDLE} on X`}>
      <svg viewBox="0 0 7 7" width="14" height="14" shapeRendering="crispEdges" aria-hidden="true">
        {px.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />)}
      </svg>
      {label && <span>{X_HANDLE}</span>}
    </a>
  );
}
