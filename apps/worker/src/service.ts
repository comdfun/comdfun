/**
 * Background service: systemd user unit on Linux, launchd agent on macOS. `install` writes the unit with the
 * current runtime/concurrency/auto-update settings (they persist across restarts); `--boot` enables lingering so a
 * Linux VPS keeps the worker running after reboots without a login session.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform, userInfo } from "node:os";
import { join } from "node:path";

export const SERVICE_NAME = "comd-worker";
export const LAUNCHD_LABEL = "fun.comd.worker";

export interface ServiceSpec {
  node: string;
  bin: string;
  args: string[];
  home: string;
  path: string;
  server?: string;
}

export function systemdUnit(s: ServiceSpec): string {
  const q = (x: string) => (/[\s"']/.test(x) ? `"${x.replace(/"/g, '\\"')}"` : x);
  return [
    "[Unit]",
    "Description=Company.md worker (comd start)",
    "Documentation=https://github.com/comd-fun/worker",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${[s.node, s.bin, ...s.args].map(q).join(" ")}`,
    "Restart=always",
    "RestartSec=10",
    `Environment=COMD_HOME=${s.home}`,
    `Environment=PATH=${s.path}`,
    ...(s.server ? [`Environment=COMD_SERVER=${s.server}`] : []),
    "Environment=COMD_SERVICE=1",
    "NoNewPrivileges=true",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

export function launchdPlist(s: ServiceSpec): string {
  const x = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const log = join(s.home, "logs", "worker.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${[s.node, s.bin, ...s.args].map((a) => `    <string>${x(a)}</string>`).join("\n")}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>COMD_HOME</key><string>${x(s.home)}</string>
    <key>PATH</key><string>${x(s.path)}</string>
    <key>COMD_SERVICE</key><string>1</string>${s.server ? `\n    <key>COMD_SERVER</key><string>${x(s.server)}</string>` : ""}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${x(log)}</string>
  <key>StandardErrorPath</key><string>${x(log)}</string>
</dict>
</plist>
`;
}

export function unitPath(os = platform()): string {
  return os === "darwin" ? join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`) : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "systemd", "user", `${SERVICE_NAME}.service`);
}

const sh = (cmd: string, args: string[], inherit = false) => execFileSync(cmd, args, { stdio: inherit ? "inherit" : "pipe", encoding: "utf8" });

export function install(spec: ServiceSpec, opts: { boot?: boolean } = {}) {
  const os = platform();
  const p = unitPath(os);
  mkdirSync(join(p, ".."), { recursive: true });
  if (os === "darwin") {
    mkdirSync(join(spec.home, "logs"), { recursive: true });
    if (existsSync(p)) try { sh("launchctl", ["unload", p]); } catch { /* not loaded */ }
    writeFileSync(p, launchdPlist(spec));
    sh("launchctl", ["load", "-w", p]);
    return `installed ${p} (starts now and at login)`;
  }
  if (os !== "linux") throw new Error("service install supports Linux (systemd) and macOS (launchd); on Windows run `comd start` in a terminal or use Task Scheduler");
  writeFileSync(p, systemdUnit(spec));
  sh("systemctl", ["--user", "daemon-reload"]);
  sh("systemctl", ["--user", "enable", "--now", SERVICE_NAME]);
  if (opts.boot) sh("loginctl", ["enable-linger", userInfo().username]);
  return `installed ${p}${opts.boot ? " (lingering enabled: survives reboots)" : ""}`;
}

export function control(action: "status" | "stop" | "restart" | "uninstall") {
  const os = platform();
  const p = unitPath(os);
  if (os === "darwin") {
    if (action === "status") return sh("launchctl", ["list", LAUNCHD_LABEL]);
    if (action === "stop") { sh("launchctl", ["unload", p]); return "stopped"; }
    if (action === "restart") { try { sh("launchctl", ["unload", p]); } catch { /* */ } sh("launchctl", ["load", "-w", p]); return "restarted"; }
    try { sh("launchctl", ["unload", p]); } catch { /* */ }
    rmSync(p, { force: true });
    return "uninstalled";
  }
  if (action === "status") { try { return sh("systemctl", ["--user", "status", "--no-pager", SERVICE_NAME]); } catch (e: any) { return String(e.stdout ?? e.message); } }
  if (action === "stop") { sh("systemctl", ["--user", "stop", SERVICE_NAME]); return "stopped"; }
  if (action === "restart") { sh("systemctl", ["--user", "daemon-reload"]); sh("systemctl", ["--user", "restart", SERVICE_NAME]); return "restarted"; }
  try { sh("systemctl", ["--user", "disable", "--now", SERVICE_NAME]); } catch { /* */ }
  rmSync(p, { force: true });
  try { sh("systemctl", ["--user", "daemon-reload"]); } catch { /* */ }
  return "uninstalled";
}

/** Stream logs; Ctrl+C leaves the viewer without stopping the service. */
export function logs(home: string, follow: boolean) {
  const os = platform();
  const child = os === "darwin"
    ? spawn("tail", ["-n", "200", ...(follow ? ["-f"] : []), join(home, "logs", "worker.log")], { stdio: "inherit" })
    : spawn("journalctl", ["--user", "-u", SERVICE_NAME, "-n", "200", "--no-pager", ...(follow ? ["-f"] : [])], { stdio: "inherit" });
  process.on("SIGINT", () => child.kill("SIGINT"));
  return new Promise<void>((r) => child.on("close", () => r()));
}

export function serviceArgs(o: { runtime: string; concurrency: number; autoUpdate: boolean }): string[] {
  return ["start", "--runtime", o.runtime, "--concurrency", String(o.concurrency), ...(o.autoUpdate ? ["--auto-update"] : [])];
}
