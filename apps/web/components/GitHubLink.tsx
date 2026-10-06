import { GITHUB_URL, GITHUB_REPO } from "@/lib/config";

/** A 9×8 pixel cat's head: ears, two eye gaps, a chin. */
const CAT: [number, number][] = [
  [1, 0], [7, 0],
  [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1],
  [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2],
  [0, 3], [1, 3], [3, 3], [4, 3], [5, 3], [7, 3], [8, 3],
  [0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4],
  [1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5],
  [2, 6], [3, 6], [4, 6], [5, 6], [6, 6],
  [3, 7], [4, 7], [5, 7],
];

/** The code on GitHub (NEXT_PUBLIC_GITHUB_URL, default github.com/comdfun/comdfun): a pixel glyph plus the repo where there is room. */
export function GitHubLink({ className = "", label = false, text }: { className?: string; label?: boolean; text?: string }) {
  return (
    <a className={`xlink ghlink ${className}`} href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label={`Company.md on GitHub (${GITHUB_REPO})`} title={`${GITHUB_REPO} on GitHub`}>
      <svg viewBox="0 0 9 8" width="16" height="14" shapeRendering="crispEdges" aria-hidden="true">
        {CAT.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />)}
      </svg>
      {label && <span>{text ?? GITHUB_REPO}</span>}
    </a>
  );
}
