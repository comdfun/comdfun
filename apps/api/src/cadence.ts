/**
 * Schedule cadences: `{every: "PT6H"}` (ISO 8601 duration; weeks/days/hours/minutes/seconds) or
 * `{cron: "0 17 * * *", tz: "Europe/London"}` (five fields, vixie semantics: when both day-of-month and
 * day-of-week are restricted, either may match). Time zones via Intl; DST gaps are skipped, overlaps fire once.
 */
export type ParsedCadence =
  | { kind: "every"; ms: number; minIntervalMs: number }
  | { kind: "cron"; spec: CronSpec; tz: string; minIntervalMs: number };

export interface CronSpec { minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>; domStar: boolean; dowStar: boolean; source: string }

const DURATION_RE = /^P(?!$)(?:(\d+)W)?(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export function parseDuration(s: string): number | null {
  if (typeof s !== "string" || s.length > 40) return null;
  const m = DURATION_RE.exec(s);
  if (!m) return null;
  const [, w, d, h, mi, sec] = m;
  return ((Number(w ?? 0) * 7 + Number(d ?? 0)) * 24 * 3600 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 + Number(sec ?? 0)) * 1000;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function field(src: string, min: number, max: number, names?: string[], nameBase = 0): Set<number> {
  const out = new Set<number>();
  const val = (t: string) => {
    const up = t.toUpperCase();
    if (names) {
      const i = names.indexOf(up);
      if (i >= 0) return i + nameBase;
    }
    if (!/^\d+$/.test(t)) throw new Error(`bad cron value "${t}"`);
    return Number(t);
  };
  for (const part of src.split(",")) {
    const [range, stepS] = part.split("/");
    const step = stepS === undefined ? 1 : Number(stepS);
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad cron step "${part}"`);
    let lo: number, hi: number;
    if (range === "*") { lo = min; hi = max; }
    else if (range.includes("-")) { const [a, b] = range.split("-"); lo = val(a); hi = val(b); }
    else { lo = val(range); hi = stepS === undefined ? lo : max; }
    if (lo < min || hi > max || lo > hi) throw new Error(`cron value out of range in "${part}" (${min}-${max})`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(src: string): CronSpec {
  const parts = src.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("cron must have five fields: minute hour day-of-month month day-of-week");
  const dow = field(parts[4], 0, 7, DAYS, 0);
  if (dow.has(7)) { dow.delete(7); dow.add(0); }
  return {
    minute: field(parts[0], 0, 59),
    hour: field(parts[1], 0, 23),
    dom: field(parts[2], 1, 31),
    month: field(parts[3], 1, 12, MONTHS, 1),
    dow,
    domStar: parts[2] === "*",
    dowStar: parts[4] === "*",
    source: src.trim(),
  };
}

const fmts = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    fmts.set(tz, f);
  }
  return f;
}

export function validTz(tz: string): boolean {
  try { fmt(tz); return true; } catch { return false; }
}

interface Local { y: number; mo: number; d: number; h: number; mi: number; dow: number }
function local(t: number, tz: string): Local {
  const p: Record<string, number> = {};
  for (const x of fmt(tz).formatToParts(new Date(t))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return { y: p.year, mo: p.month, d: p.day, h: p.hour === 24 ? 0 : p.hour, mi: p.minute, dow: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() };
}
function offset(t: number, tz: string): number {
  const l = local(t, tz);
  return Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi) - Math.floor(t / 60_000) * 60_000;
}
/** Local wall time → UTC ms (Date.UTC normalises overflow such as day 32 or hour 24). */
function zoned(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const o1 = offset(guess, tz);
  let t = guess - o1;
  const o2 = offset(t, tz);
  if (o2 !== o1) t = guess - o2;
  return t;
}

export function nextCron(spec: CronSpec, tz: string, afterMs: number): number {
  let t = Math.floor(afterMs / 60_000) * 60_000 + 60_000;
  for (let guard = 0; guard < 200_000; guard++) {
    const l = local(t, tz);
    if (!spec.month.has(l.mo)) { t = Math.max(t + 60_000, zoned(l.y, l.mo + 1, 1, 0, 0, tz)); continue; }
    const domOk = spec.dom.has(l.d), dowOk = spec.dow.has(l.dow);
    const dayOk = spec.domStar && spec.dowStar ? true : spec.domStar ? dowOk : spec.dowStar ? domOk : domOk || dowOk;
    if (!dayOk) { t = Math.max(t + 60_000, zoned(l.y, l.mo, l.d + 1, 0, 0, tz)); continue; }
    if (!spec.hour.has(l.h)) { t = Math.max(t + 60_000, zoned(l.y, l.mo, l.d, l.h + 1, 0, tz)); continue; }
    if (!spec.minute.has(l.mi)) { t += 60_000; continue; }
    return t;
  }
  throw new Error(`cron "${spec.source}" never fires`);
}

export function parseCadence(c: unknown, refMs = Date.UTC(2026, 0, 1)): ParsedCadence | { error: string } {
  if (!c || typeof c !== "object" || Array.isArray(c)) return { error: 'cadence must be {every: "PT6H"} or {cron, tz}' };
  const o = c as Record<string, unknown>;
  const keys = Object.keys(o);
  if (o.every !== undefined) {
    if (keys.some((k) => k !== "every")) return { error: "cadence {every} takes no other fields" };
    if (typeof o.every === "string" && /^P.*[YM].*$/.test(o.every.split("T")[0]) && /\d+[YM]/.test(o.every.split("T")[0])) return { error: "years and months are not fixed lengths; use cron for calendar cadences" };
    const ms = parseDuration(String(o.every));
    if (!ms) return { error: "cadence.every must be an ISO 8601 duration such as PT6H, P1D or P2W" };
    return { kind: "every", ms, minIntervalMs: ms };
  }
  if (o.cron !== undefined) {
    if (keys.some((k) => k !== "cron" && k !== "tz")) return { error: "cadence {cron, tz} takes no other fields" };
    const tz = o.tz === undefined ? "UTC" : String(o.tz);
    if (!validTz(tz)) return { error: `unknown time zone ${tz}` };
    let spec: CronSpec;
    try { spec = parseCron(String(o.cron)); } catch (e) { return { error: (e as Error).message }; }
    let min = Infinity;
    let t = nextCron(spec, tz, refMs);
    for (let i = 0; i < 400; i++) {
      const n = nextCron(spec, tz, t);
      min = Math.min(min, n - t);
      t = n;
      if (min <= 60_000) break;
    }
    return { kind: "cron", spec, tz, minIntervalMs: min };
  }
  return { error: 'cadence must be {every: "PT6H"} or {cron, tz}' };
}

/** First slot strictly after `afterMs` (every: slots are anchor + k·interval). */
export function nextSlot(c: ParsedCadence, anchorMs: number, afterMs: number): number {
  if (c.kind === "every") {
    if (afterMs < anchorMs) return anchorMs;
    const k = Math.floor((afterMs - anchorMs) / c.ms) + 1;
    return anchorMs + k * c.ms;
  }
  return nextCron(c.spec, c.tz, afterMs);
}

/** Slots in (dueMs, nowMs] — fired late after an outage; reported as `missedSlots`. */
export function missedBetween(c: ParsedCadence, anchorMs: number, dueMs: number, nowMs: number, cap = 100_000): number {
  if (c.kind === "every") return Math.max(0, Math.min(cap, Math.floor((nowMs - dueMs) / c.ms)));
  let n = 0;
  let t = dueMs;
  while (n < cap) {
    t = nextCron(c.spec, c.tz, t);
    if (t > nowMs) break;
    n++;
  }
  return n;
}
