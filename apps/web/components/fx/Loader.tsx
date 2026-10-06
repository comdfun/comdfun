// Loading states: a pixel hourglass that flips, a quill that writes, and dithered skeleton rows.

export function Hourglass({ size = 48 }: { size?: number }) {
  return (
    <span className="hourglass-wrap" style={{ display: "inline-block", width: size, height: (size * 4) / 3 }}>
      <svg className="hourglass" viewBox="0 0 12 16" shapeRendering="crispEdges" style={{ width: "100%", height: "100%" }} aria-hidden="true">
        <rect x="0" y="0" width="12" height="2" fill="#9a6234" />
        <rect x="0" y="14" width="12" height="2" fill="#9a6234" />
        <rect x="1" y="2" width="1" height="12" fill="#6b3f1d" />
        <rect x="10" y="2" width="1" height="12" fill="#6b3f1d" />
        <path d="M3 2h6v1h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1z M5 7h2v1h1v1h1v1h1v4h-8v-4h1v-1h1v-1h1z" fill="#2a2433" />
        <g className="sand-top"><path d="M3 2h6v1h-1v1h-1v1h-2v-1h-1v-1h-1z" fill="#ffc83d" /></g>
        <rect className="stream" x="5.5" y="6" width="1" height="5" fill="#ffc83d" />
        <g className="sand-bot"><path d="M4 12h4v1h1v1h-6v-1h1z" fill="#ffc83d" /></g>
      </svg>
    </span>
  );
}

export function Quill() {
  return (
    <svg className="quill-write" viewBox="0 0 160 40" shapeRendering="crispEdges" aria-hidden="true">
      <path className="ink" d="M4 30 C 14 10, 22 34, 30 22 S 46 12, 52 26 S 70 30, 78 18 S 96 14, 102 28 S 122 26, 132 16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" />
      <g className="nib">
        <rect x="4" y="2" width="4" height="4" fill="#f3ebd3" />
        <rect x="6" y="6" width="4" height="4" fill="#f3ebd3" />
        <rect x="8" y="10" width="4" height="4" fill="#9a9488" />
        <rect x="2" y="0" width="4" height="4" fill="#f3ebd3" />
        <rect x="0" y="-4" width="4" height="4" fill="#ff4fd8" />
      </g>
    </svg>
  );
}

export function Loading({ label = "Reading the docket" }: { label?: string }) {
  return (
    <div className="wrap">
      <div className="loading" role="status" aria-live="polite">
        <Hourglass />
        <span className="label">{label}…</span>
        <Quill />
      </div>
      <div className="skel" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => <i key={i} />)}
      </div>
    </div>
  );
}
