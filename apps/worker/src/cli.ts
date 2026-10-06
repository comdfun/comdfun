#!/usr/bin/env node
/**
 * comd — the worker CLI for Company.md.
 *
 *   comd start [--runtime claude|codex] [--model ID] [--effort high] [--concurrency N] [--auto-update]
 *   comd status | pair | unlink | update
 *   comd skills | skills remove <id> | skills add <id>
 *   comd service install [--boot] | status | logs [-f] | stop | uninstall | restart [--runtime X] [--concurrency N]
 *
 * Global: --server <url> (or COMD_SERVER), --home <dir> (or COMD_HOME).
 */
import { BUILTIN_SKILLS, makeSignedEnvelope } from "@company/protocol";
import { companyHome, loadConfig, saveConfig, wsUrl, type WorkerConfig } from "./config.ts";
import { defaultRuntime, detectRuntime, detectTools } from "./detect.ts";
import { makeRuntime } from "./runtimes.ts";
import { Daemon } from "./daemon.ts";
import { ensureRegistered, pair } from "./pair.ts";
import { control, install, logs, serviceArgs } from "./service.ts";
import { CHECK_INTERVAL_MS, applyUpdate, checkForUpdate, packageInfo } from "./updater.ts";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { spawn } from "node:child_process";

export interface Args { cmd: string[]; flags: Record<string, string | boolean> }

export function parseArgs(argv: string[]): Args {
  const cmd: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const valued = new Set(["runtime", "concurrency", "server", "home", "model", "effort"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-f") flags.follow = true;
    else if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (v !== undefined) flags[k] = v;
      else if (valued.has(k) && argv[i + 1] && !argv[i + 1].startsWith("-")) flags[k] = argv[++i];
      else flags[k] = true;
    } else cmd.push(a);
  }
  return { cmd, flags };
}

const HELP = `comd ${packageInfo().version} — a seat at the bar of Company.md

  comd start [--runtime claude|codex] [--model ID] [--effort LEVEL] [--concurrency N] [--auto-update]
                      pair on first run, then take work until stopped; premium work (contracts,
                      front ends) needs a top-tier model at high effort (e.g. --effort high)
  comd status      seat, enrollment, presence and dispatch standing
  comd skills      list skills;  comd skills remove <id> | add <id>
  comd pair        pair this device with a Counsel (one device per seat)
  comd unlink      revoke this device's enrollment
  comd update      install the latest release (checksum-verified)
  comd service install [--boot] | status | logs [-f] | stop | uninstall | restart

  --server <url>  control plane (default ${process.env.COMD_SERVER ?? "https://api.comd.fun"})
  --home <dir>    config directory (default ~/.comd)
Not affiliated with Robinhood.`;

async function getJson(url: string): Promise<any> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url}: ${r.status}`);
  return r.json();
}

async function runnableSkills(cfg: WorkerConfig): Promise<string[]> {
  let ids: string[];
  try {
    const s = await getJson(`${cfg.server}/skills`);
    ids = s.skills.filter((x: any) => x.role !== "reference").map((x: any) => x.id);
  } catch {
    ids = BUILTIN_SKILLS.filter((s) => s.role !== "reference").map((s) => s.id);
  }
  return ids.filter((id) => !cfg.removedSkills.includes(id));
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { cmd, flags } = parseArgs(argv);
  const home = companyHome(typeof flags.home === "string" ? flags.home : undefined);
  const server = typeof flags.server === "string" ? flags.server.replace(/\/$/, "") : undefined;
  const c0 = cmd[0] ?? "help";
  if (c0 === "help" || flags.help) { console.log(HELP); return 0; }
  if (c0 === "version" || flags.version) { console.log(packageInfo().version); return 0; }
  const cfg = loadConfig(home, server);

  switch (c0) {
    case "pair": {
      await pair(home, cfg);
      return 0;
    }
    case "start": {
      const rtName = (typeof flags.runtime === "string" ? flags.runtime : cfg.runtime ?? (await defaultRuntime())) as WorkerConfig["runtime"];
      if (!rtName || !["claude", "codex", "mock"].includes(rtName)) { console.error("Install and log in to Claude Code (`claude`) or Codex (`codex`), or pass --runtime."); return 1; }
      cfg.runtime = rtName;
      if (flags.concurrency !== undefined) cfg.concurrency = Math.max(1, Math.min(8, Number(flags.concurrency) || 1));
      if (flags["auto-update"]) cfg.autoUpdate = true;
      saveConfig(home, cfg);
      if (!cfg.tokenId) await pair(home, cfg);
      else {
        const e = await getJson(`${cfg.server}/enrollments/${cfg.device.deviceKey}`).catch(() => null);
        if (e && e.status !== "active") { console.log(`Enrollment ${e.status}${e.reason ? ` (${e.reason})` : ""}; pairing again.`); await pair(home, cfg); }
      }
      await ensureRegistered(home, cfg);
      const info = await detectRuntime(rtName, { model: typeof flags.model === "string" ? flags.model : null, effort: typeof flags.effort === "string" ? flags.effort : null });
      const runtime = await makeRuntime(rtName, info);
      const tools = await detectTools();
      const skills = await runnableSkills(cfg);
      const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
      log(`runtime ${runtime.info.name} ${runtime.info.version ?? ""} model ${runtime.info.model ?? "default"} effort ${runtime.info.effort ?? "default"}${runtime.info.premium ? " (premium: contract and front-end work)" : " (standard: no contract or front-end work)"}; foundry ${tools.foundry ? "yes" : "no"}, docker ${tools.docker ? "yes" : "no"}; ${skills.length} skills; concurrency ${cfg.concurrency}`);
      if (!tools.foundry) log("Foundry not found: contract work will not be routed here (install with `curl -L https://foundry.paradigm.xyz | bash`).");
      const d = new Daemon({ server: cfg.server, wsUrl: wsUrl(cfg.server), tokenId: cfg.tokenId!, key: cfg.device, runtime, tools, skills, concurrency: cfg.concurrency, home, version: packageInfo().version, log });
      d.on("refused", (f: any) => { if ([4003, 4004, 4009].includes(f.code)) { log(`refused: ${f.reason}`); process.exit(2); } });
      await d.start();
      let updating = false;
      const maybeUpdate = async () => {
        if (!cfg.autoUpdate || updating) return;
        const rel = await checkForUpdate().catch(() => null);
        if (!rel) return;
        updating = true;
        log(`update ${rel.version} available: finishing current work first`);
        await d.drain();
        try {
          await applyUpdate(rel, fetch, log);
          await d.stop();
          if (process.env.COMD_SERVICE === "1") process.exit(0); // the service manager restarts us
          spawn(process.execPath, process.argv.slice(1), { stdio: "inherit", detached: true }).unref();
          process.exit(0);
        } catch (e) {
          log(`update failed: ${(e as Error).message}; continuing on ${packageInfo().version}`);
          updating = false;
        }
      };
      void maybeUpdate();
      setInterval(() => void maybeUpdate(), CHECK_INTERVAL_MS).unref();
      await new Promise<void>((resolve) => {
        const bye = async () => { log("stopping"); await d.stop(); resolve(); };
        process.once("SIGINT", bye);
        process.once("SIGTERM", bye);
      });
      return 0;
    }
    case "status": {
      console.log(`device   ${cfg.device.deviceKey}`);
      console.log(`server   ${cfg.server}`);
      console.log(`seat     ${cfg.tokenId ? `Counsel #${cfg.tokenId}` : "not paired (run comd pair)"}${cfg.agentId ? ` · agent ${cfg.agentId}` : ""}`);
      console.log(`runtime  ${cfg.runtime ?? "auto"} · concurrency ${cfg.concurrency} · auto-update ${cfg.autoUpdate ? "on" : "off"}`);
      try {
        const st = await getJson(`${cfg.server}/workers/${cfg.device.deviceKey}/standing?queue=0`);
        console.log(`enrolled ${st.enrollment.status}${st.enrollment.reason ? ` (${st.enrollment.reason})` : ""}`);
        console.log(`online   ${st.presence.online ? `yes · working ${st.presence.working}/${st.presence.concurrency}${st.presence.paused ? " · paused" : ""}` : "no"}`);
        console.log(`dispatch ${st.dispatch.eligible ? "eligible" : `not eligible: ${st.dispatch.reasons.join("; ")}`}`);
      } catch (e) { console.log(`control plane unreachable: ${(e as Error).message}`); }
      for (const n of ["claude", "codex"] as const) {
        const i = await detectRuntime(n);
        console.log(`${n.padEnd(8)} ${i ? `${i.version} · model ${i.model ?? "default"}${i.premium ? " (premium)" : ""}` : "not found"}`);
      }
      const t = await detectTools();
      console.log(`tools    foundry ${t.foundry ? "yes" : "no"} · docker ${t.docker ? "yes" : "no"} · image ${t.image ? "yes" : "no"} · audio ${t.audio ? "yes" : "no"} · video ${t.video ? "yes" : "no"} · node ${t.node}`);
      return 0;
    }
    case "skills": {
      const sub = cmd[1];
      if (sub === "remove" || sub === "add") {
        const id = cmd[2];
        if (!id) { console.error(`usage: comd skills ${sub} <id>`); return 1; }
        cfg.removedSkills = sub === "remove" ? [...new Set([...cfg.removedSkills, id])] : cfg.removedSkills.filter((x) => x !== id);
        saveConfig(home, cfg);
        console.log(`${id} ${sub === "remove" ? "disabled" : "enabled"}; restart the worker (comd service restart) to apply.`);
        return 0;
      }
      let list: any[];
      try { list = (await getJson(`${cfg.server}/skills`)).skills; } catch { list = BUILTIN_SKILLS; }
      for (const s of list) {
        const on = s.role === "reference" ? "ref" : cfg.removedSkills.includes(s.id) ? "off" : "on";
        console.log(`${on.padEnd(4)} ${s.id.padEnd(28)} ${String(s.role).padEnd(10)} ${String(s.inference ?? "-").padEnd(9)} ${(s.requires ?? []).join(",")}`);
      }
      return 0;
    }
    case "unlink": {
      const env = makeSignedEnvelope(cfg.device, "enrollment.revoke", { deviceKey: cfg.device.deviceKey, reason: "unlinked with comd unlink" });
      const r = await fetch(`${cfg.server}/enrollments/revoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(env) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { console.error(`unlink failed: ${r.status} ${(body as any).error ?? ""} ${(body as any).detail ?? ""}`); return 1; }
      const was = cfg.tokenId;
      cfg.tokenId = null;
      cfg.wallet = null;
      cfg.agentId = null;
      cfg.pairedAt = null;
      saveConfig(home, cfg);
      console.log(`Unlinked${was ? ` from Counsel #${was}` : ""}. The seat can now be paired on another device.`);
      return 0;
    }
    case "update": {
      const rel = await checkForUpdate();
      if (!rel) { console.log(`up to date (${packageInfo().version})`); return 0; }
      await applyUpdate(rel);
      return 0;
    }
    case "service": {
      const sub = cmd[1] ?? "status";
      if (sub === "install" || sub === "restart") {
        if (typeof flags.runtime === "string") cfg.runtime = flags.runtime as WorkerConfig["runtime"];
        if (flags.concurrency !== undefined) cfg.concurrency = Math.max(1, Math.min(8, Number(flags.concurrency) || 1));
        if (flags["auto-update"]) cfg.autoUpdate = true;
        saveConfig(home, cfg);
        const bin = realpathSync(process.argv[1]);
        const spec = { node: process.execPath, bin, args: serviceArgs({ runtime: cfg.runtime ?? (await defaultRuntime()) ?? "claude", concurrency: cfg.concurrency, autoUpdate: cfg.autoUpdate }), home, path: process.env.PATH ?? "/usr/bin:/bin", server: cfg.server };
        if (sub === "install") console.log(install(spec, { boot: !!flags.boot }));
        else { install(spec, {}); console.log(control("restart")); }
        return 0;
      }
      if (sub === "logs") { await logs(home, !!flags.follow); return 0; }
      if (sub === "status" || sub === "stop" || sub === "uninstall") { console.log(control(sub)); return 0; }
      console.error(`unknown service command ${sub}`);
      return 1;
    }
    default:
      console.error(`unknown command ${c0}\n\n${HELP}`);
      return 1;
  }
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && (realpathSync(process.argv[1]) === self || process.env.COMD_CLI_ENTRY === "1")) {
  main().then((code) => { if (code !== 0) process.exit(code); }).catch((e) => { console.error(`comd: ${(e as Error).message}`); process.exit(1); });
}
