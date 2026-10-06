/**
 * Sandboxed command execution for the Clerk (verifier) and Registrar (deployer).
 *
 * - Work happens in a throwaway temp copy of the submission.
 * - The child gets a stripped environment (no service secrets): PATH, HOME, locale, TMPDIR and
 *   whatever the caller passes explicitly.
 * - Wall-clock timeout kills the whole process group; optional CPU-seconds limit via `ulimit -t`.
 * - Network: when the skill does not require network, the command runs in a fresh network
 *   namespace (`unshare -rn`) if the kernel allows it; otherwise proxies are pointed at a dead
 *   port and package managers are put in offline mode ("env-blocked", best effort).
 */
import { spawn, spawnSync } from "node:child_process";
import { access, constants, cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type NetworkMode = "allowed" | "unshare" | "env-blocked";

export interface RunOptions {
  cwd: string;
  /** extra env vars merged over the stripped base */
  env?: Record<string, string>;
  timeoutMs?: number;
  /** allow outbound network (default false) */
  network?: boolean;
  /** CPU-seconds ceiling via ulimit -t (POSIX sh required) */
  cpuSeconds?: number;
  /** keep at most this many bytes of each stream (tail). Default 256 KiB. */
  maxOutputBytes?: number;
  /** override HOME for the child (default: the service's HOME, so toolchain caches like ~/.svm resolve) */
  home?: string;
}

export interface RunResult {
  command: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  network: NetworkMode;
}

const PASS_THROUGH_NETWORK_VARS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
  "npm_config_registry",
  "npm_config_cafile",
  "NPM_CONFIG_REGISTRY",
];

let unshareOk: boolean | undefined;
/** Probe once whether unprivileged network namespaces work here. Disable with SANDBOX_NET=env. */
export function canUnshareNetwork(): boolean {
  if (process.env.SANDBOX_NET === "env") return false;
  if (unshareOk === undefined) {
    try {
      const r = spawnSync("unshare", ["-rn", "true"], { stdio: "ignore", timeout: 5000 });
      unshareOk = r.status === 0;
    } catch {
      unshareOk = false;
    }
  }
  return unshareOk;
}

export function strippedEnv(opts: { network: boolean; extra?: Record<string, string>; home?: string; tmp: string }): Record<string, string> {
  const base: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: opts.home ?? process.env.HOME ?? opts.tmp,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TERM: "dumb",
    TMPDIR: opts.tmp,
    CI: "1",
    NO_COLOR: "1",
    FOUNDRY_DISABLE_NIGHTLY_WARNING: "1",
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_audit: "false",
  };
  if (opts.network) {
    for (const k of PASS_THROUGH_NETWORK_VARS) if (process.env[k]) base[k] = process.env[k]!;
  } else {
    Object.assign(base, {
      HTTP_PROXY: "http://127.0.0.1:9",
      HTTPS_PROXY: "http://127.0.0.1:9",
      http_proxy: "http://127.0.0.1:9",
      https_proxy: "http://127.0.0.1:9",
      ALL_PROXY: "http://127.0.0.1:9",
      npm_config_offline: "true",
    });
  }
  return { ...base, ...(opts.extra ?? {}) };
}

/** Run a command; never throws for non-zero exit (inspect `code`). */
export async function runSandboxed(cmd: string, args: string[], opts: RunOptions): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const maxOut = opts.maxOutputBytes ?? 256 * 1024;
  const tmp = await mkdtemp(path.join(os.tmpdir(), "comd-run-"));
  const network = opts.network ?? false;
  let netMode: NetworkMode = "allowed";
  let file = cmd;
  let argv = args;
  if (opts.cpuSeconds && opts.cpuSeconds > 0) {
    argv = ["-c", `ulimit -t ${Math.ceil(opts.cpuSeconds)} && exec "$@"`, "sh", file, ...argv];
    file = "/bin/sh";
  }
  if (!network) {
    if (canUnshareNetwork()) {
      argv = ["-rn", file, ...argv];
      file = "unshare";
      netMode = "unshare";
    } else netMode = "env-blocked";
  }
  const env = strippedEnv({ network, extra: opts.env, home: opts.home, tmp });
  const started = Date.now();
  const command = [cmd, ...args].join(" ");
  try {
    return await new Promise<RunResult>((resolve) => {
      const child = spawn(file, argv, { cwd: opts.cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const cap = (s: string) => (s.length > maxOut ? s.slice(s.length - maxOut) : s);
      child.stdout.on("data", (d) => (stdout = cap(stdout + d.toString())));
      child.stderr.on("data", (d) => (stderr = cap(stderr + d.toString())));
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, timeoutMs);
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ command, code: 127, signal: null, stdout, stderr: `${stderr}${err.message}`, timedOut, durationMs: Date.now() - started, network: netMode });
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        resolve({ command, code, signal, stdout, stderr, timedOut, durationMs: Date.now() - started, network: netMode });
      });
    });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Copy `src` into a fresh temp dir (skipping VCS metadata and dependency folders). */
export async function makeSandboxCopy(src: string, skip: string[] = [".git", "node_modules"]): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "comd-clerk-"));
  const dir = path.join(root, "work");
  const skipSet = new Set(skip);
  await cp(src, dir, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    filter: (s) => !skipSet.has(path.basename(s)) || s === src,
  });
  return { dir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function isExecutable(p: string): Promise<boolean> {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve a binary from an explicit path, an env var (e.g. FORGE_BIN) or PATH. */
export async function findBinary(name: string, opts: { explicit?: string; envVar?: string; env?: Record<string, string | undefined> } = {}): Promise<string | null> {
  const env = opts.env ?? process.env;
  // explicitly configured (argument first, then env var) but missing: do not silently fall back
  if (opts.explicit) return (await isExecutable(opts.explicit)) ? opts.explicit : null;
  const fromEnv = opts.envVar ? env[opts.envVar] : undefined;
  if (fromEnv) return (await isExecutable(fromEnv)) ? fromEnv : null;
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, name);
    if (await isExecutable(p)) return p;
  }
  const foundryHome = path.join(os.homedir(), ".foundry", "bin", name);
  if (await isExecutable(foundryHome)) return foundryHome;
  return null;
}
