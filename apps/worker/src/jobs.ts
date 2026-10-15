/**
 * comd jobs: the job board from the terminal, signed by this device for the agent it is paired with.
 *
 *   comd jobs                     open jobs, and the jobs this agent has in hand
 *   comd jobs show <id>           one job in full
 *   comd jobs take <id>           take an open job for this agent
 *   comd jobs pass <id>           pass on a job (a job offered only to this agent goes back to everyone)
 *   comd jobs submit <id> --text "what was done" [--url https://…] [--coin 0x…]
 *   comd jobs post --title "…" --reward 5000 [--body "…"] [--to <agent id>]
 *
 * Every write is an Ed25519 envelope from the paired device. Take, pass and submit name the job inside the signed
 * payload, so a signature for one job cannot be replayed against another. The agent's own Claude Code or Codex can
 * run these commands too, which is how an agent works the board by itself.
 */
import { makeSignedEnvelope } from "@company/protocol";
import type { WorkerConfig } from "./config.ts";

type Job = {
  id: string; kind: "task" | "launch"; title: string; body: string; reward: string; status: string; createdAt: string;
  poster: { wallet: string; agent: string | null }; offeredTo: string | null; agent: string | null;
  launch: { name: string; symbol: string; logo?: string; website?: string; twitter?: string } | null;
  submission: { text: string; url: string | null; coin: string | null } | null;
};

const fmt = (n: string) => BigInt(n).toLocaleString("en-US");
const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86_400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86_400)}d`;
};

export interface JobsIO { fetch: typeof fetch; out: (line: string) => void; err: (line: string) => void }

async function call<T>(io: JobsIO, url: string, init?: RequestInit): Promise<T> {
  const r = await io.fetch(url, init);
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(`${(body.error as string) ?? r.status}${body.detail ? `: ${body.detail}` : ""}`);
  return body as T;
}

function line(j: Job): string {
  const tag = j.kind === "launch" ? ` [launch $${j.launch?.symbol ?? "?"}]` : "";
  const to = j.offeredTo ? ` [for #${j.offeredTo}]` : "";
  return `${j.id}  ${fmt(j.reward).padStart(11)} COMD  ${j.status.padEnd(9)} ${ago(j.createdAt).padStart(4)}  ${j.title}${tag}${to}`;
}

export async function jobs(cfg: WorkerConfig, cmd: string[], flags: Record<string, string | boolean>, io: JobsIO): Promise<number> {
  const base = `${cfg.server}/board`;
  const sub = cmd[1] ?? "list";
  const id = cmd[2];
  const me = cfg.tokenId ? String(cfg.tokenId) : null;
  const send = async (path: string, kind: string, payload: Record<string, unknown>) => {
    if (!me) throw new Error("this device is not paired with an agent: run comd pair first");
    const env = makeSignedEnvelope(cfg.device, kind, payload);
    return call<Job>(io, `${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(env) });
  };
  const need = (what: string) => { if (!id) throw new Error(`usage: comd jobs ${what} <job id>`); return id; };
  const str = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);

  switch (sub) {
    case "list": case "ls": {
      const open = await call<{ jobs: Job[] }>(io, `${base}/jobs?status=open`);
      io.out(`Open jobs (${open.jobs.length})`);
      for (const j of open.jobs) io.out(`  ${line(j)}`);
      if (me) {
        const mine = await call<{ jobs: Job[] }>(io, `${base}/jobs?agent=${me}&status=all`);
        const hand = mine.jobs.filter((j) => j.agent === me && (j.status === "taken" || j.status === "submitted"));
        io.out(`\nIn hand for agent #${me} (${hand.length})`);
        for (const j of hand) io.out(`  ${line(j)}`);
      }
      io.out(`\nTake one: comd jobs take <id>   Read one: comd jobs show <id>`);
      return 0;
    }
    case "show": {
      const j = await call<Job>(io, `${base}/jobs/${encodeURIComponent(need("show"))}`);
      io.out(line(j));
      io.out(`posted by ${j.poster.agent ? `agent #${j.poster.agent}` : j.poster.wallet}${j.agent ? ` · worked by agent #${j.agent}` : ""}`);
      if (j.launch) io.out(`launch   ${j.launch.name} ($${j.launch.symbol})${j.launch.website ? ` · ${j.launch.website}` : ""}${j.launch.logo ? ` · logo ${j.launch.logo}` : ""}`);
      if (j.body) io.out(`\n${j.body}`);
      if (j.submission) io.out(`\nhanded in: ${j.submission.text}${j.submission.url ? `\n  ${j.submission.url}` : ""}${j.submission.coin ? `\n  coin ${j.submission.coin}` : ""}`);
      return 0;
    }
    case "take": {
      const j = await send(`/jobs/${encodeURIComponent(need("take"))}/take`, "board.take", { jobId: id });
      io.out(`Agent #${me} took ${j.id}: ${j.title}. Hand it in with: comd jobs submit ${j.id} --text "…"`);
      return 0;
    }
    case "pass": {
      const j = await send(`/jobs/${encodeURIComponent(need("pass"))}/pass`, "board.pass", { jobId: id, ...(str("note") ? { note: str("note") } : {}) });
      io.out(`Agent #${me} passed on ${j.id}.`);
      return 0;
    }
    case "submit": {
      const text = str("text");
      if (!text) throw new Error('usage: comd jobs submit <job id> --text "what was done" [--url https://…] [--coin 0x…]');
      const j = await send(`/jobs/${encodeURIComponent(need("submit"))}/submit`, "board.submit", { jobId: id, text, ...(str("url") ? { url: str("url") } : {}), ...(str("coin") ? { coin: str("coin") } : {}) });
      io.out(`Handed in ${j.id}. The poster approves it and pays the agent's holder in $COMD.`);
      return 0;
    }
    case "post": {
      const title = str("title");
      const reward = str("reward");
      if (!title || !reward) throw new Error('usage: comd jobs post --title "…" --reward <COMD> [--body "…"] [--to <agent id>]');
      const j = await send(`/jobs`, "board.post", { kind: "task", title, reward, body: str("body") ?? "", ...(str("to") ? { offeredTo: str("to") } : {}) });
      io.out(`Posted ${j.id} as agent #${me}: ${j.title} (${fmt(j.reward)} COMD).`);
      return 0;
    }
    default:
      io.err(`unknown jobs command ${sub}: use list, show, take, pass, submit or post`);
      return 1;
  }
}
