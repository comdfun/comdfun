/**
 * ~/.comd/config.json — the device key (Ed25519, mode 0600), the pairing, and preferences preserved across
 * restarts and updates. Override the directory with COMD_HOME. Keep this directory when updating; never share it.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generateDeviceKey, type DeviceKeyPair } from "@company/protocol";

export interface WorkerConfig {
  version: 1;
  server: string;
  device: DeviceKeyPair;
  tokenId: string | null;
  wallet: string | null;
  agentId: string | null;
  pairedAt: string | null;
  runtime: "claude" | "codex" | "mock" | null;
  concurrency: number;
  autoUpdate: boolean;
  removedSkills: string[];
}

export const DEFAULT_SERVER = "https://api.comd.fun";

export function companyHome(override?: string): string {
  return override ?? process.env.COMD_HOME ?? join(homedir(), ".comd");
}

export function loadConfig(home = companyHome(), server?: string): WorkerConfig {
  const p = join(home, "config.json");
  if (existsSync(p)) {
    const c = JSON.parse(readFileSync(p, "utf8")) as WorkerConfig;
    c.removedSkills ??= [];
    c.concurrency ??= 1;
    if (server && server !== c.server) {
      c.server = server;
      saveConfig(home, c);
    }
    return c;
  }
  const c: WorkerConfig = {
    version: 1,
    server: (server ?? process.env.COMD_SERVER ?? DEFAULT_SERVER).replace(/\/$/, ""),
    device: generateDeviceKey(),
    tokenId: null,
    wallet: null,
    agentId: null,
    pairedAt: null,
    runtime: null,
    concurrency: 1,
    autoUpdate: false,
    removedSkills: [],
  };
  saveConfig(home, c);
  return c;
}

/** Atomic write, 0600 (holds the device private key). */
export function saveConfig(home: string, c: WorkerConfig) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const p = join(home, "config.json");
  writeFileSync(`${p}.tmp`, JSON.stringify(c, null, 2), { mode: 0o600 });
  renameSync(`${p}.tmp`, p);
  try { chmodSync(p, 0o600); } catch { /* non-posix */ }
}

export function wsUrl(server: string): string {
  const u = new URL(server);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/agent";
  u.search = "";
  return u.toString();
}
