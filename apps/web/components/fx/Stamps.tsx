// Rubber stamps and wax seals. Server-safe: the animation runs from CSS when the element is revealed (.rv → .in).

export function RStamp({ kind = "sustained", children, lg, reveal = true, i }: { kind?: "sustained" | "overruled" | "sealed" | "exhibit"; children?: React.ReactNode; lg?: boolean; reveal?: boolean; i?: number }) {
  const cls = kind === "overruled" ? "over" : kind === "sealed" ? "sealed" : kind === "exhibit" ? "c-gold" : "";
  const word = children ?? (kind === "overruled" ? "Overruled" : kind === "sealed" ? "Sealed" : kind === "exhibit" ? "Exhibit" : "Sustained");
  return (
    <span className={`rstamp ${cls} ${lg ? "lg" : ""} ${reveal ? "rv" : ""}`} style={i != null ? ({ ["--i" as string]: i } as React.CSSProperties) : undefined}>
      {word}
      <span className="splat" aria-hidden="true" />
    </span>
  );
}

/** 16×16 pixel wax seal: crimson blob with a scales-of-justice emboss. */
export function WaxSvg({ tone = "crimson" }: { tone?: "crimson" | "violet" | "gold" }) {
  const C = { crimson: ["#ff3b5c", "#b0123a", "#ff8fa3", "#4f0718"], violet: ["#9b5cff", "#5b2bc4", "#c9a6ff", "#2a1166"], gold: ["#ffc83d", "#b07a00", "#ffe598", "#4f3600"] }[tone];
  const [f, dk, hi, sh] = C;
  const rows = [
    ".....xxxxxx.....",
    "...xxffffffxx...",
    "..xffhhffffffx..",
    ".xffhffffffffdx.",
    ".xfhffeeeeffffx.",
    "xffffe.ee.effffx",
    "xfffeeeeeeeefffx",
    "xfffe.e..e.efffx",
    "xfffe.e..e.efffx",
    "xffffeeeeeefffdx",
    "xffff..ee..ffddx",
    ".xffffeeeeffddx.",
    ".xdfffffffffddx.",
    "..xddffffffddx..",
    "...xxddddddxx...",
    ".....xxxxxx.....",
  ];
  const col: Record<string, string> = { x: sh, f, d: dk, h: hi, e: dk };
  const rects: React.ReactNode[] = [];
  rows.forEach((r, y) => {
    let x = 0;
    while (x < r.length) {
      const c = r[x];
      let w = 1;
      while (x + w < r.length && r[x + w] === c) w++;
      if (c !== ".") rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={w} height={1} fill={col[c]} />);
      x += w;
    }
  });
  return (
    <svg viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      {rects}
    </svg>
  );
}
