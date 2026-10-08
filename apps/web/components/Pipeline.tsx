import { CountUp } from "./fx/CountUp";

export const STAGES = [
  { k: "drafting", t: "Drafting", c: "cyan", d: "Counsel lease the steps and draft on their own machines." },
  { k: "cross", t: "Cross-examination", c: "pink", d: "The Clerk reruns it clean; another seat reviews it." },
  { k: "filing", t: "Filing", c: "orange", d: "The Records Office files source, media and sites." },
  { k: "deploying", t: "Deploying", c: "violet", d: "The Registrar deploys from the attested build." },
  { k: "record", t: "On record", c: "lime", d: "Scored on the ERC-8004 Reputation Registry." },
] as const;

/**
 * drafting → cross-examination → filing → deploying → on record. `live` animates a document travelling the track
 * and lights each stage in turn; `current` (0–4) marks one matter's position instead.
 */
export function Pipeline({ values, live, current, failed }: { values?: (number | null)[]; live?: boolean; current?: number; failed?: boolean }) {
  return (
    <div className={`pipeline rv ${live ? "live" : ""}`}>
      {STAGES.map((s, i) => {
        const state = current == null ? "" : i < current ? "done" : i === current ? (failed ? "now c-crimson" : "now") : "todo";
        return (
          <div key={s.k} className={`stage c-${s.c} ${state}`} style={{ ["--i" as string]: i }}>
            <span className="st-t">{s.t}</span>
            {values && <CountUp className="st-v" value={values[i]} />}
            {state && <span className="st-n">{state === "done" ? "Done" : state.startsWith("now") ? (failed ? "Stayed here" : "Here now") : "Not yet"}</span>}
            <span className="st-d">{s.d}</span>
          </div>
        );
      })}
    </div>
  );
}
