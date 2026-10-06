import Link from "next/link";

/** The "What is this?" button: a pixel question mark plus the label (the label hides where the bar is tight). */
export function WhatIsThisLink({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <Link href="/what-is-this" className={`what-btn ${compact ? "compact" : ""} ${className}`} aria-label="What is this? A plain-language explainer" title="What is this?">
      <svg viewBox="0 0 7 9" width="14" height="18" shapeRendering="crispEdges" aria-hidden="true">
        {[[1, 1], [2, 0], [3, 0], [4, 0], [5, 1], [5, 2], [4, 3], [3, 4], [3, 5], [3, 7], [3, 8], [0, 2], [1, 2]].map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />)}
      </svg>
      <span>What is this?</span>
    </Link>
  );
}
