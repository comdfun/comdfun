// The job board, from the browser. Types mirror apps/api/src/board.ts.
export type JobKind = "task" | "launch";
export type JobStatus = "open" | "taken" | "submitted" | "done" | "cancelled";
export interface LaunchSpec { name: string; symbol: string; logo?: string; website?: string; twitter?: string; description?: string }
export interface BoardJob {
  id: string;
  createdAt: string;
  updatedAt: string;
  kind: JobKind;
  title: string;
  body: string;
  reward: string;
  status: JobStatus;
  poster: { wallet: string; agent: string | null };
  offeredTo: string | null;
  agent: string | null;
  takenAt: string | null;
  passedBy: string[];
  launch: LaunchSpec | null;
  submission: { text: string; url: string | null; coin: string | null; at: string } | null;
  payment: { to: string; amount: string; tx: string | null } | null;
  doneAt: string | null;
  events: { at: string; what: string; by: string; note?: string }[];
}
export interface BoardSummary { open: number; taken: number; done: number; paid: string; agents: number }
export interface AgentBoardStats { agent: string; done: number; active: number; earned: string; posted: number; offers: number }

export const STATUS_LABEL: Record<JobStatus, string> = { open: "Open", taken: "In progress", submitted: "In review", done: "Done", cancelled: "Cancelled" };

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/board${path}`, {
    method: init?.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  }).catch(() => { throw new Error("The job board could not be reached. Try again in a moment."); });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) {
    const d = data as { detail?: string; error?: string } | null;
    throw new Error(d?.detail || d?.error || `The job board answered ${res.status}.`);
  }
  return data as T;
}

export const board = {
  summary: () => call<BoardSummary>(""),
  jobs: (q: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString();
    return call<{ jobs: BoardJob[] }>(`/jobs${qs ? `?${qs}` : ""}`).then((r) => r.jobs);
  },
  job: (id: string) => call<BoardJob>(`/jobs/${encodeURIComponent(id)}`),
  agent: (id: string | number) => call<AgentBoardStats>(`/agents/${id}`),
  /**
   * A signed action: ask for a nonce, have the wallet sign the message, send it with the body. One signature per
   * action, nothing on chain, no gas.
   */
  async act<T>(address: string, sign: (message: string) => Promise<string>, path: string, body: Record<string, unknown>): Promise<T> {
    const { message } = await call<{ message: string }>("/nonce", { method: "POST", body: { address } });
    const signature = await sign(message);
    return call<T>(path, { method: "POST", body: { ...body, address, signature } });
  },
};

/** Whole $COMD with separators: "25000" → "25,000". */
export const comd = (s: string | number) => { try { return BigInt(String(s)).toLocaleString("en-US"); } catch { return String(s); } };

export const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
