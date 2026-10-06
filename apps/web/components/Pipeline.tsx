import { CountUp } from "./fx/CountUp";

export const STAGES = [
  { k: "drafting", t: "Drafting", c: "cyan", d: "Counsel lease the steps and draft on their own machines." },
  { k: "cross", t: "Cross-examination", c: "pink", d: "The Clerk reruns it clean; another seat reviews it." },
  { k: "filing", t: "Filing", c: "orange", d: "The Records Office files source, media and sites." },
  { k: "deploying", t: "Deploying", c: "violet", d: "The Registrar deploys from the attested build." },
  { k: "record", t: "On record", c: "lime", d: "Scored on the ERC-8004 Reputation Registry." },
] as const;

const DOC = (
  <svg viewBox="0 0 11 14" shapeRendering="crispEdges" aria-hidden="true">
    <rect x="0" y="0" width="9" height="14" fill="#f3ebd3" />
    <rect x="7" y="0" width="2" height="2" fill="#000" />
    <rect x="9" y="2" width="2" height="12" fill="#a69e86" />
    <rect x="2" y="3" width="5" height="1" fill="#1b1840" />
    <rect x="2" y="6" width="5" height="1" fill="#1b1840" />
    <rect x="2" y="9" width="3" height="1" fill="#1b1840" />
    <rect x="4" y="11" width="4" height="2" fill="#ff3b5c" />
  </svg>
);

/**
 * drafting → cross-examination → filing → deploying → on record. `live` animates a document travelling the track
 * and lights each stage in turn; `current` (0–4) marks one matter's position instead.
 */
export function Pipeline({ values, live, current, failed }: { values?: (number | null)[]; live?: boolean; current?: number; failed?: boolean }) {
  return (
    <div className={`pipeline rv ${live ? "live" : ""}`}>
      <div className="track" aria-hidden="true" />
      {live && <div className="runner" aria-hidden="true">{DOC}</div>}
      {STAGES.map((s, i) => {
        const state = current == null ? "" : i < current ? "done" : i === current ? (failed ? "now c-crimson" : "now") : "todo";
        return (
          <div key={s.k} className={`stage c-${s.c} ${state}`} style={{ ["--i" as string]: i }}>
            <span className="st-n">{String(i + 1).padStart(2, "0")} · {state === "done" ? "done" : state.startsWith("now") ? (failed ? "stayed" : "now") : "stage"}</span>
            <span className="st-t">{s.t}</span>
            {values && <CountUp className="st-v" value={values[i]} />}
            <span className="st-d">{s.d}</span>
          </div>
        );
      })}
    </div>
  );
}
