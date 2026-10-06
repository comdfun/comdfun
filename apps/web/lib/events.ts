// Docket events: the API's /swarm `events[]` are `{at, type, data}`; the web shows `{kind, text, links}`.
// Pure and client-safe. Legacy `{kind, text}` events pass through unchanged.
import type { RawSwarmEvent, SwarmEvent } from "./types";

const counsel = (t: unknown) => (t == null ? "Counsel" : `Counsel #${String(t).padStart(4, "0")}`);
const human = (s: unknown) =>
  String(s ?? "")
    .replace(/^skill:/, "")
    .replace(/^launch:/, "incorporation · ")
    .replace(/[_-]+/g, " ")
    .trim();
const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const str = (v: unknown) => (v == null ? undefined : String(v));

/** Events too chatty for the docket feed. */
const QUIET = new Set(["lease.progress", "lease.handed_back", "order.quoted", "fuzz.result"]);

type Ctx = { objective?: (jobId: string) => string | undefined };

export function normalizeEvent(e: RawSwarmEvent | SwarmEvent, ctx: Ctx = {}): SwarmEvent | null {
  if ("text" in e && typeof (e as SwarmEvent).text === "string" && (e as SwarmEvent).kind) return e as SwarmEvent;
  const r = e as RawSwarmEvent;
  const d = (r.data ?? {}) as Record<string, unknown>;
  if (QUIET.has(r.type)) return null;
  const jobId = str(d.jobId);
  const obj = jobId && ctx.objective ? ctx.objective(jobId) : undefined;
  const about = (fallback: string) => (obj ? cut(obj, 90) : fallback);
  const base = { at: r.at, type: r.type, jobId: jobId ?? null, tokenId: str(d.tokenId) ?? null, requestId: str(d.requestId) ?? null, launchId: str(d.launchId) ?? null };
  const ev = (kind: string, text: string): SwarmEvent => ({ ...base, kind, text });
  switch (r.type) {
    case "job.opened":
      return ev("opened", `Matter opened: ${about(human(d.template) || "a new matter")}`);
    case "lease.assigned":
      return ev("lease", `${counsel(d.tokenId)} took ${human(d.skill) || d.nodeKey}${obj ? ` · ${cut(obj, 60)}` : ""}`);
    case "lease.expired":
      return ev("rejected", `Lease expired: ${counsel(d.tokenId)} on ${d.nodeKey}`);
    case "submission.received":
      return ev("filed", `${counsel(d.tokenId)} filed ${d.nodeKey}${typeof d.files === "number" ? ` · ${d.files} file${d.files === 1 ? "" : "s"}` : ""}`);
    case "node.accepted":
      return ev("accepted", `Sustained: ${human(d.skill) || d.nodeKey} by ${counsel(d.tokenId)}${obj ? ` · ${cut(obj, 60)}` : ""}`);
    case "node.rejected":
      return ev("rejected", `Overruled: ${d.nodeKey} by ${counsel(d.tokenId)}${d.detail ? ` · ${cut(String(d.detail), 70)}` : ""}`);
    case "node.failed":
      return ev("rejected", `Mistrial on ${d.nodeKey}${d.reason ? ` · ${cut(String(d.reason), 70)}` : ""}`);
    case "node.reposted":
      return ev("review", `Re-posted ${d.nodeKey} (attempt ${d.attempt ?? "?"})`);
    case "review.findings":
      return ev("review", `Cross-examination: ${d.findings ?? 0} finding${d.findings === 1 ? "" : "s"} on ${d.nodeKey}`);
    case "panel.agreed":
      return ev("signed", `Panel agreed ${d.agreeing ?? "?"}/${d.quorum ?? "?"}${obj ? ` · ${cut(obj, 60)}` : ""}`);
    case "job.delivering":
      return ev("filed", `Delivering: ${about("matter")}`);
    case "job.published":
      return ev("published", `Filed with the Records Office: ${about(String(d.repoUrl ?? "source").replace("https://github.com/", ""))}`);
    case "job.completed":
      return ev("accepted", `On the record: ${about("matter closed")}`);
    case "job.blocked":
      return ev("rejected", `Stayed: ${about(String(d.reason ?? "blocked"))}`);
    case "launch.admission":
      return ev("launched", `Incorporation #${d.launchNumber} admitted${d.kind ? ` · ${human(d.kind)}` : ""}`);
    case "launch.deploying":
      return ev("deployed", `Incorporation #${d.launchNumber} deploying`);
    case "launch.live": {
      const tok = typeof d.token === "object" && d.token ? (d.token as { symbol?: string }).symbol : undefined;
      return ev("launched", `Incorporated: ${tok ? `$${tok}` : `#${d.launchNumber}`} is live on Robinhood Chain`);
    }
    case "launch.parked":
      return ev("rejected", `Incorporation parked${d.reason ? ` · ${cut(String(d.reason), 70)}` : ""}`);
    case "oracle.opened":
      return ev("review", `Ruling requested · panel of ${d.panelSize ?? "?"}, quorum ${d.quorum ?? "?"}`);
    case "oracle.agreed":
      return ev("signed", `Panel agreed ${d.agreed ?? "?"}/${d.quorum ?? "?"} → ${cut(String(d.answer ?? ""), 50)}`);
    case "oracle.attested":
      return ev("signed", "Ruling sealed (EIP-712)");
    case "seat.paired":
      return ev("connected", `${counsel(d.tokenId)} took a seat at the bar`);
    case "seat.revoked":
      return ev("rejected", `${counsel(d.tokenId)} left the bar${d.reason ? ` · ${d.reason}` : ""}`);
    case "seat.registered":
      return ev("connected", `${counsel(d.tokenId)} registered as ERC-8004 agent ${d.agentId}`);
    case "site.live":
      return ev("published", `Site live: ${d.label ?? d.url}`);
    default:
      if (r.type?.startsWith("oracle.")) return ev("rejected", `Ruling ${r.type.slice(7)}${d.failure ? ` · ${cut(String(d.failure), 60)}` : ""}`);
      return ev(r.type?.split(".").pop() ?? "event", human(r.type));
  }
}

export function normalizeEvents(list: unknown, ctx: Ctx = {}): SwarmEvent[] {
  if (!Array.isArray(list)) return [];
  return list.map((e) => normalizeEvent(e as RawSwarmEvent, ctx)).filter((e): e is SwarmEvent => !!e);
}

/** Where an event links on the docket. */
export function eventHref(e: SwarmEvent) {
  if (e.requestId) return `/oracle/${e.requestId}`;
  if (e.launchId) return `/launches/${e.launchId}`;
  if (e.jobId) return `/jobs/${e.jobId}`;
  if (e.tokenId) return `/agents/${e.tokenId}`;
  return null;
}

/** Colour family and stamp word per event kind. */
export const EVENT_STYLE: Record<string, { c: string; w: string }> = {
  accepted: { c: "lime", w: "Sustained" },
  signed: { c: "violet", w: "Sealed" },
  launched: { c: "gold", w: "Incorporated" },
  deployed: { c: "orange", w: "Registrar" },
  opened: { c: "cyan", w: "Opened" },
  rejected: { c: "crimson", w: "Overruled" },
  review: { c: "pink", w: "Panel" },
  published: { c: "orange", w: "Filed" },
  filed: { c: "orange", w: "Filed" },
  connected: { c: "gold", w: "Seated" },
  lease: { c: "cyan", w: "Leased" },
};
