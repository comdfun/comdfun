import { formatUnits } from "viem";

export function short(addr?: string | null, a = 6, b = 4) {
  if (!addr) return "—";
  return addr.length > a + b + 1 ? `${addr.slice(0, a)}…${addr.slice(-b)}` : addr;
}

export function ago(ts?: string | number | null, now = Date.now()) {
  if (ts == null) return "—";
  const t = typeof ts === "number" ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return "—";
  let s = Math.round((now - t) / 1000);
  const future = s < 0;
  s = Math.abs(s);
  const out =
    s < 45 ? "just now" : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : s < 86400 * 60 ? `${Math.round(s / 86400)}d` : `${Math.round(s / (86400 * 30))}mo`;
  if (out === "just now") return out;
  return future ? `in ${out}` : `${out} ago`;
}

export function fmtNum(n?: number | bigint | null, max = 2) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: max });
}

export function compact(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function units(v?: bigint | string | null, decimals = 18, max = 4) {
  if (v == null || v === "") return "—";
  const n = Number(formatUnits(BigInt(v), decimals));
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? Math.max(max, 6) : max });
}

/** $COMD amount (18 decimals): whole numbers stay whole, otherwise up to 2 places. */
export function comd(v?: bigint | string | null) {
  if (v == null || v === "") return "—";
  const n = Number(formatUnits(BigInt(v), 18));
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 });
}


export function duration(ms?: number | null) {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function bytes(n?: number | null) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function hashInt(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** "MATTER 2026-0412" style docket number, stable per id. */
export function docketNo(kind: string, id: string, createdAt?: string | null) {
  const y = createdAt ? new Date(createdAt).getUTCFullYear() : new Date().getUTCFullYear();
  const n = (hashInt(id) % 9999) + 1;
  return `${kind.toUpperCase()} ${y}-${String(n).padStart(4, "0")}`;
}

export function caption(objective?: string | null, max = 140) {
  const o = (objective ?? "").replace(/\s+/g, " ").trim();
  return o.length > max ? `${o.slice(0, max - 1)}…` : o;
}

export function pct(n?: number | null, digits = 0) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function counselName(tokenId: string | number) {
  return `Counsel #${String(tokenId).padStart(4, "0")}`;
}

export function iso(ts?: string | number | null) {
  if (ts == null) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}
