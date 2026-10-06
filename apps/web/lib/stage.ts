import type { Job, JobNode } from "./types";

export type Tone = "brass" | "ok" | "bad" | "muted";
export interface Stage { label: string; tone: Tone; title: string; live?: boolean }

const done = (nodes: JobNode[]) => nodes.filter((n) => n.state === "accepted").length;

/** Docket stage for a matter. Plain meaning in `title` (IMD: building / reviewed / N done / review failed / runtime error). */
export function jobStage(j: Pick<Job, "state" | "blockedReason"> & { nodes?: JobNode[] }): Stage {
  const nodes = j.nodes ?? [];
  const d = done(nodes);
  switch (j.state) {
    case "executing":
    case "planning":
    case "queued": {
      const running = nodes.find((n) => n.state === "running" || n.live);
      if (running?.role === "review") return { label: "Cross-examining", tone: "brass", title: "an independent counsel is reviewing", live: true };
      if (d > 0) return { label: `${d} filed`, tone: "brass", title: `${d} of ${nodes.length} steps done, still building`, live: true };
      return { label: j.state === "planning" ? "Planning" : "Drafting", tone: "brass", title: "building", live: true };
    }
    case "completed": {
      const reviewed = nodes.some((n) => n.role === "review" && n.state === "accepted");
      if (reviewed) return { label: "Cross-examined", tone: "ok", title: "reviewed and accepted" };
      return { label: d > 1 ? `${d} filed` : "Filed", tone: "ok", title: `${d || 1} done` };
    }
    case "blocked": {
      const rej = nodes.some((n) => n.state === "rejected") || /review/.test(j.blockedReason ?? "");
      if (rej) return { label: "Overruled", tone: "bad", title: "review failed" };
      if (/runtime|failed/.test(j.blockedReason ?? "") || nodes.some((n) => n.state === "failed")) return { label: "Mistrial", tone: "bad", title: "runtime error" };
      return { label: "Stayed", tone: "bad", title: j.blockedReason ?? "blocked" };
    }
    case "failed":
      return { label: "Mistrial", tone: "bad", title: "runtime error" };
    case "cancelled":
      return { label: "Withdrawn", tone: "muted", title: "cancelled" };
    default:
      return { label: j.state, tone: "muted", title: j.state };
  }
}

export const JOB_TABS = [
  { key: "all", label: "All", states: [] as string[] },
  { key: "running", label: "Running", states: ["executing", "planning", "queued"] },
  { key: "incomplete", label: "Incomplete", states: ["blocked", "cancelled", "failed"] },
  { key: "completed", label: "Completed", states: ["completed"] },
];

export function oracleStage(status: string): Stage {
  switch (status) {
    case "assessing":
      return { label: "Panel deliberating", tone: "brass", title: "panel answering", live: true };
    case "reproducing":
      return { label: "Reproducing", tone: "brass", title: "deployer reproducing the chain evidence", live: true };
    case "attested":
      return { label: "Sealed", tone: "ok", title: "signed attestation" };
    case "disagreed":
      return { label: "Hung panel", tone: "bad", title: "quorum did not match" };
    case "mismatch":
      return { label: "Mismatch", tone: "bad", title: "reproduction did not match the panel" };
    case "refused":
      return { label: "Refused", tone: "bad", title: "the question was refused" };
    case "blocked":
      return { label: "Stayed", tone: "bad", title: "blocked" };
    default:
      return { label: "Failed", tone: "bad", title: status };
  }
}

export const ORACLE_TABS = [
  { key: "all", label: "All", statuses: [] as string[] },
  { key: "answering", label: "Answering", statuses: ["assessing", "reproducing"] },
  { key: "failed", label: "Failed", statuses: ["disagreed", "blocked", "mismatch", "refused", "failed"] },
  { key: "signed", label: "Signed", statuses: ["attested"] },
];

export function scheduleStage(status: string): Stage {
  switch (status) {
    case "active":
      return { label: "Running", tone: "ok", title: "active", live: true };
    case "exhausted":
      return { label: "Every run used", tone: "muted", title: "exhausted" };
    case "paused":
      return { label: "Paused", tone: "brass", title: "paused after three failed runs; a top-up resumes it" };
    case "cancelled":
      return { label: "Cancelled", tone: "bad", title: "cancelled" };
    case "expired":
      return { label: "Expired", tone: "muted", title: "expired" };
    default:
      return { label: status, tone: "muted", title: status };
  }
}

export function verdictTone(v?: string | null): Tone {
  if (!v) return "muted";
  if (/accept|pass|confirm|sent|attested|agreed/.test(v)) return "ok";
  if (/reject|fail|overrul|refus|disagree|mismatch/.test(v)) return "bad";
  if (/pending|queued|running|waiting/.test(v)) return "brass";
  return "muted";
}

export function cadenceText(c: { every?: string; cron?: string; tz?: string }) {
  if (c.every) {
    const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(c.every);
    if (!m) return `every ${c.every}`;
    const [, w, d, h, mi] = m;
    const parts = [w && `${w} week${w === "1" ? "" : "s"}`, d && `${d} day${d === "1" ? "" : "s"}`, h && `${h} hour${h === "1" ? "" : "s"}`, mi && `${mi} min`].filter(Boolean);
    return `every ${parts.join(" ")}`.replace(/^every 1 (day|hour|week)$/, "every $1");
  }
  return `cron ${c.cron} ${c.tz ?? "UTC"}`;
}
