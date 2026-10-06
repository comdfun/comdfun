// Tiny indexed-colour raster: colours are 0xRRGGBB ints, -1 = transparent.

export type Color = number;
export const T = -1;

export function hex(c: string): Color {
  return parseInt(c.replace("#", ""), 16);
}
export function toCss(c: Color): string {
  return "#" + c.toString(16).padStart(6, "0").toUpperCase();
}
export function mix(a: Color, b: Color, t: number): Color {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
export function luma(c: Color): number {
  return (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;
}

/** Map of sprite chars → colour (or T / undefined for transparent). */
export type Tex = (x: number, y: number) => Color;
export type Key = Record<string, Color | Tex | undefined>;

export class Raster {
  readonly px: Int32Array;
  constructor(readonly w: number, readonly h: number, fill: Color = T) {
    this.px = new Int32Array(w * h).fill(fill);
  }
  get(x: number, y: number): Color {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return T;
    return this.px[y * this.w + x];
  }
  set(x: number, y: number, c: Color): void {
    if (c === T || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }
  rect(x: number, y: number, w: number, h: number, c: Color): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  /** Draw a char-grid sprite at (ox, oy). Optional auto-outline in `outline` colour (4-neighbour). */
  sprite(grid: readonly string[], ox: number, oy: number, key: Key, outline?: Color): void {
    const H = grid.length;
    const filled = (x: number, y: number) => {
      if (y < 0 || y >= H || x < 0 || x >= grid[y].length) return false;
      const ch = grid[y][x];
      return ch !== "." && ch !== " " && key[ch] !== undefined && key[ch] !== T;
    };
    if (outline !== undefined) {
      const W = Math.max(...grid.map((r) => r.length));
      for (let y = -1; y <= H; y++)
        for (let x = -1; x <= W; x++) {
          if (filled(x, y)) continue;
          if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) this.set(ox + x, oy + y, outline);
        }
    }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < grid[y].length; x++) {
        const ch = grid[y][x];
        if (ch === "." || ch === " ") continue;
        const k = key[ch];
        if (k === undefined) throw new Error(`sprite: no colour for '${ch}'`);
        this.set(ox + x, oy + y, typeof k === "function" ? k(ox + x, oy + y) : k);
      }
  }
  /** Copy another raster in at integer scale (nearest neighbour). Transparent source pixels skipped. */
  blit(src: Raster, ox: number, oy: number, scale = 1): void {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const c = src.px[y * src.w + x];
        if (c === T) continue;
        if (scale === 1) this.set(ox + x, oy + y, c);
        else this.rect(ox + x * scale, oy + y * scale, scale, scale, c);
      }
  }
  map(fn: (c: Color, x: number, y: number) => Color): void {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        if (this.px[i] !== T) this.px[i] = fn(this.px[i], x, y);
      }
  }
  clone(): Raster {
    const r = new Raster(this.w, this.h);
    r.px.set(this.px);
    return r;
  }

  /**
   * SVG with one <rect> per horizontal run of equal colour, grouped by fill.
   * `background` (if given) is painted once as a full rect and runs of that colour are skipped.
   */
  toSvg(opts: { width?: number; height?: number; background?: Color; title?: string } = {}): string {
    const { w, h } = this;
    const width = opts.width ?? w;
    const height = opts.height ?? h;
    const groups = new Map<Color, string[]>();
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        const c = this.px[y * w + x];
        let e = x + 1;
        while (e < w && this.px[y * w + e] === c) e++;
        if (c !== T && c !== opts.background) {
          let g = groups.get(c);
          if (!g) groups.set(c, (g = []));
          g.push(`<rect x="${x}" y="${y}" width="${e - x}" height="1"/>`);
        }
        x = e;
      }
    }
    let body = "";
    if (opts.title) body += `<title>${escapeXml(opts.title)}</title>`;
    if (opts.background !== undefined) body += `<rect width="${w}" height="${h}" fill="${toCss(opts.background)}"/>`;
    for (const [c, rects] of groups) body += `<g fill="${toCss(c)}">${rects.join("")}</g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${body}</svg>`;
  }
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}
