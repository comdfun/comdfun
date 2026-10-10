// Typed client for the control plane API. Server components call these; in mock mode they read fixtures directly.
import { API_URL, MOCK } from "./config";
import type * as T from "./types";
import { normalizeEvents } from "./events";
import { normalizeJob, normalizeNames, normalizeSeat, normalizeSubmissions, normalizeWorker } from "./normalize";

export class ApiError extends Error {
  constructor(public status: number, public code: string, public detail?: string) {
    super(`${status} ${code}${detail ? `: ${detail}` : ""}`);
  }
}

async function raw<R>(path: string, init?: { revalidate?: number | false }): Promise<R> {
  if (MOCK) {
    const { mockFetch } = await import("./mock");
    const r = mockFetch("GET", path);
    if (r.status >= 400) throw new ApiError(r.status, (r.json as { error?: string })?.error ?? "error");
    return r.json as R;
  }
  const revalidate = init?.revalidate ?? 10;
  const res = await fetch(`${API_URL}${path}`, {
    headers: { accept: "application/json" },
    ...(revalidate === false ? { cache: "no-store" as const } : { next: { revalidate } }),
  });
  if (!res.ok) {
    let code = "error";
    let detail: string | undefined;
    try {
      const j = (await res.json()) as { error?: string; detail?: string };
      code = j.error ?? code;
      detail = j.detail;
    } catch {}
    throw new ApiError(res.status, code, detail);
  }
  return (await res.json()) as R;
}

/** GET that resolves to null on any failure (unreachable API, 404). Pages render an "off the record" state. */
export async function get<R>(path: string, init?: { revalidate?: number | false }): Promise<R | null> {
  try {
    return await raw<R>(path, init);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) console.warn(`[api] ${path}: ${(e as Error).message}`);
    return null;
  }
}

const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const api = {
  version: () => get<{ commit: string; branch: string; deployedAt: string; protocolVersion: string; features: string[] }>("/version"),
  health: () => get<T.Health>("/health"),
  leaderboard: (limit = 25) => get<{
    at: string;
    seats: { allTime: T.LeaderSeat[]; week: T.LeaderSeat[] };
    holders: { allTime: T.LeaderHolder[]; week: T.LeaderHolder[] };
    counts: { registered: number; everWorked: number; online: number; idle: number };
  }>(`/leaderboard?limit=${limit}`, { revalidate: 30 }),
  swarm: () => swarm(),
  services: () => get<{ services: { kind: string; label?: string; keyPrefix: string; version: string; up: boolean; lastSeenAt: string; claims: number }[] }>("/services"),
  jobs: (o: { q?: string; before?: string; limit?: number; state?: string; exclude?: string }) => get<{ count: number; jobs: T.JobListItem[] }>(`/jobs${qs(o)}`),
  job: async (id: string) => normalizeJob(await get<Record<string, unknown>>(`/jobs/${encodeURIComponent(id)}`, { revalidate: 2 })),
  submissions: async (id: string, job?: T.Job | null) => normalizeSubmissions(await get<unknown>(`/jobs/${encodeURIComponent(id)}/submissions`), job),
  records: (id: string) => get<T.JobRecords>(`/jobs/${encodeURIComponent(id)}/records`),
  oracleCounts: () => get<{ total: number; byStatus: Record<string, number> }>("/oracle/counts"),
  oracleRequests: (o: { q?: string; before?: string; limit?: number; status?: string }) => get<{ count: number; attester: string; requests: T.OracleListItem[] }>(`/oracle/requests${qs(o)}`),
  oracle: (id: string) => get<T.OracleRequest>(`/oracle/requests/${encodeURIComponent(id)}`, { revalidate: 2 }),
  attestation: (id: string) => get<T.Attestation>(`/oracle/requests/${encodeURIComponent(id)}/attestation`, { revalidate: 2 }),
  publications: (o: { q?: string; type?: string; sort?: string; page?: number; pageSize?: number }) => get<T.Publications>(`/publications${qs(o)}`),
  publicationCounts: (q?: string) => get<{ counts: Record<string, number> }>(`/publications/counts${qs({ q })}`),
  schedules: (o: { before?: string; limit?: number; owner?: string }) => get<{ count: number; schedules: T.Schedule[] }>(`/schedules${qs(o)}`),
  schedule: (id: string) => get<T.Schedule>(`/schedules/${encodeURIComponent(id)}`),
  seatRecords: () => get<{ count: number; seats: T.SeatRecord[] }>("/seats/records", { revalidate: 5 }),
  seatOwners: () => get<{ owners: (string | null)[] }>("/seats/owners", { revalidate: 30 }),
  /** The ERC-8004 registration document (+ OpenSea attributes) the API serves as the token URI. */
  counselMetadata: (id: string) => get<{ attributes?: { trait_type: string; value: string }[]; active?: boolean; x402Support?: boolean; founding?: number | null }>(`/agents/by-token/${Number(id)}.json`, { revalidate: 60 }),
  founding: () => get<{ limit: number; registered: number; spotsLeft: number; seats: { tokenId: string; agentId: string; rank: number; owner: string | null; registeredAt: string }[] }>("/seats/founding", { revalidate: 15 }),
  seat: async (id: string, work = 50) => normalizeSeat(await get<Record<string, unknown>>(`/seats/${encodeURIComponent(id)}${qs({ work, reviews: 50 })}`)),
  workers: async () => {
    const r = await get<{ count: number; workers: Record<string, unknown>[] }>("/workers");
    return r ? { count: r.count, workers: r.workers.map(normalizeWorker) } : null;
  },
  contributors: () => get<{ count: number; contributors: T.Contributor[] }>("/contributors", { revalidate: 30 }),
  names: async () => normalizeNames(await get<Record<string, unknown>>("/names", { revalidate: 60 })),
  earnings: (wallet: string) => get<{ wallet: string; count: number; earnings: unknown[]; rewards?: T.SeatReward[] }>(`/wallets/${encodeURIComponent(wallet)}/earnings`, { revalidate: false }),
  launches: (o: { limit?: number; before?: number }) => get<{ count: number; launches: T.LaunchListItem[] }>(`/launches${qs(o)}`),
  launch: (id: string) => get<T.Launch>(`/launches/${encodeURIComponent(id)}?work=1`, { revalidate: 2 }),
  assurances: (id: string) => get<T.Assurances>(`/launches/${encodeURIComponent(id)}/assurances`),
  policies: () => get<{ count: number; policies: T.LaunchPolicy[] }>("/launch/policies", { revalidate: 60 }),
  capabilities: () => get<T.Capabilities>("/requests/capabilities", { revalidate: 60 }),
};

/** GET /swarm with events normalized; job events are captioned with the matter's objective when it can be read. */
async function swarm(): Promise<T.Swarm | null> {
  const s = await get<Omit<T.Swarm, "events"> & { events?: unknown[] }>("/swarm");
  if (!s) return null;
  const raw = (s.events ?? []) as { type?: string; data?: { jobId?: string } }[];
  const ids = [...new Set(raw.map((e) => e.data?.jobId).filter((x): x is string => typeof x === "string"))].slice(0, 14);
  const objectives = new Map<string, string>();
  if (ids.length) {
    const jobs = await mapLimit(ids, 6, (id) => get<{ objective?: string }>(`/jobs/${encodeURIComponent(id)}`, { revalidate: 30 }));
    ids.forEach((id, i) => jobs[i]?.objective && objectives.set(id, jobs[i]!.objective!));
  }
  return { ...s, events: normalizeEvents(s.events, { objective: (id) => objectives.get(id) }) };
}

/** Parallel map with a concurrency cap (used to enrich list rows from detail routes). */
export async function mapLimit<A, B>(items: A[], limit: number, fn: (a: A) => Promise<B>): Promise<B[]> {
  const out: B[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}
