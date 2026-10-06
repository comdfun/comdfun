import { api } from "./api";
import { MOCK } from "./config";
import type { Activity, Swarm } from "./types";

export function activityFrom(s: Swarm | null): Activity {
  if (!s) return { at: Date.now(), reachable: false, workflows: 0, jobs: 0, oracle: 0, working: 0, total: 0, online: 0, acceptedLastDay: 0, health: "down", mock: MOCK };
  const h = s.health;
  const services = [h.verifierUp, h.publisherUp, h.deployerUp].filter((x) => x === false).length;
  return {
    at: s.at,
    reachable: h.reachable,
    workflows: 0,
    jobs: s.counts.jobStates?.executing ?? s.counts.tasksInProgress ?? 0,
    oracle: h.oraclesDoneLastDay ?? 0,
    working: h.workingNow,
    total: s.counts.jobs,
    online: h.agentsOnline,
    acceptedLastDay: h.acceptedLastDay,
    health: !h.reachable ? "down" : services ? "degraded" : "ok",
    mock: MOCK,
    events: (s.events ?? []).slice(0, 24),
    launchesLive: s.counts.launchesLive,
    inferenceTokens: s.counts.inferenceTokens,
  };
}

export async function getActivity(): Promise<Activity> {
  return activityFrom(await api.swarm());
}
