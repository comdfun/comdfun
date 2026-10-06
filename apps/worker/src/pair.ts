/**
 * First-run pairing: ask Chambers for a code, show the pairing link, wait for the holder's wallet to sign the
 * WorkerAuthorization, then make sure the seat is registered as an ERC-8004 agent (an unregistered seat cannot
 * connect). One Counsel authorises one active device.
 */
import type { WorkerConfig } from "./config.ts";
import { saveConfig } from "./config.ts";

export interface PairIO { log(m: string): void; sleep(ms: number): Promise<void>; fetch: typeof fetch }

const defaultIO: PairIO = { log: (m) => console.log(m), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), fetch };

async function j(io: PairIO, url: string, init?: RequestInit) {
  const r = await io.fetch(url, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 202) throw new Error(`${init?.method ?? "GET"} ${new URL(url).pathname}: ${r.status} ${(body as any).error ?? ""} ${(body as any).detail ?? ""}`);
  return body as any;
}

export async function pair(home: string, cfg: WorkerConfig, io: PairIO = defaultIO, timeoutMs = 15 * 60_000): Promise<WorkerConfig> {
  const start = await j(io, `${cfg.server}/pair/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceKey: cfg.device.deviceKey }) });
  io.log("");
  io.log("  PAIR THIS DEVICE");
  io.log(`  Open ${start.pairUrl}`);
  io.log(`  Code ${start.code} (expires in 10 minutes)`);
  io.log("  Connect the wallet that holds your Counsel, choose the seat, and sign. Nothing is sent on chain to pair.");
  io.log("");
  const until = Date.now() + timeoutMs;
  let status: any = null;
  while (Date.now() < until) {
    status = await j(io, `${cfg.server}/pair/${start.code}`).catch(() => null);
    if (status?.consumed && status.enrolled) break;
    if (status?.expired) throw new Error("the pairing code expired; run `comd pair` again");
    await io.sleep(3000);
  }
  if (!status?.enrolled) throw new Error("pairing timed out");
  cfg.tokenId = String(status.tokenId);
  cfg.wallet = status.wallet;
  cfg.agentId = status.agentId ?? null;
  cfg.pairedAt = new Date().toISOString();
  saveConfig(home, cfg);
  io.log(`  Filed. This device now sits for Counsel #${cfg.tokenId}.`);
  await ensureRegistered(home, cfg, io, timeoutMs);
  return cfg;
}

/** Wait until the seat is bound to an ERC-8004 agent (the pairing page offers the register transaction). */
export async function ensureRegistered(home: string, cfg: WorkerConfig, io: PairIO = defaultIO, timeoutMs = 15 * 60_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  let shown = false;
  while (Date.now() < until) {
    const e = await j(io, `${cfg.server}/enrollments/${cfg.device.deviceKey}`).catch(() => null);
    if (e?.status !== "active") throw new Error(`enrollment is ${e?.status ?? "unknown"}${e?.reason ? `: ${e.reason}` : ""}; run \`comd pair\``);
    if (e.agentId) {
      cfg.agentId = String(e.agentId);
      saveConfig(home, cfg);
      return;
    }
    if (!shown) {
      shown = true;
      io.log("  This Counsel is not yet registered as an ERC-8004 agent; an unregistered seat cannot connect.");
      io.log(`  Register it on the pairing page, or send the transaction from ${cfg.server}/agents/register-intent?tokenId=${cfg.tokenId}`);
      io.log(`  then POST ${cfg.server}/agents/bind {tokenId, agentId}. Waiting…`);
    }
    await io.sleep(5000);
  }
  throw new Error("registration not seen yet; start again once the register transaction is mined");
}
