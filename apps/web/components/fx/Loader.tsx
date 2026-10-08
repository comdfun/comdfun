// Loading state: a short progress line and three skeleton rows. Quiet, no mascots.

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skel" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => <i key={i} />)}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="wrap loading" role="status" aria-live="polite">
      <div className="loading-bar" aria-hidden="true"><span /></div>
      <span className="label">{label}</span>
      <Skeleton />
    </div>
  );
}
