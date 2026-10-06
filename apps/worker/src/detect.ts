/**
 * What this machine can do: agent runtimes (Claude Code, Codex) with their versions and configured models,
 * Foundry, Docker, and media tools. Advertised in `hello` so Chambers routes only work the seat can do.
 * Premium work (contracts and front ends) only goes to seats on a top-tier model at high effort: the runtime
 * advertises `model` and `effort`, and `premium` = isPremiumRuntime(model, effort). Chambers re-checks.
 * Override what is advertised with COMD_MODEL / COMD_EFFORT (or `--model` / `--effort`).
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PREMIUM_MODEL_RE, isPremiumRuntime, type RuntimeInfo, type ToolInfo } from "@company/protocol";

export function run(cmd: string, args: string[], timeoutMs = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, env: process.env }, (err, stdout, stderr) => resolve(err ? null : `${stdout}${stderr}`.trim()));
  });
}

const firstVersion = (s: string | null) => s?.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? null;

export function claudeModel(env = process.env): { model: string | null; effort: string | null } {
  const envEffort = env.CLAUDE_EFFORT ?? env.CLAUDE_CODE_EFFORT_LEVEL ?? null;
  if (env.ANTHROPIC_MODEL) return { model: env.ANTHROPIC_MODEL, effort: envEffort };
  for (const p of [join(homedir(), ".claude", "settings.json"), join(homedir(), ".claude.json")]) {
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      const effort = typeof j.effortLevel === "string" ? j.effortLevel : typeof j.effort === "string" ? j.effort : envEffort;
      if (typeof j.model === "string") return { model: j.model, effort };
    } catch { /* absent */ }
  }
  return { model: null, effort: envEffort };
}

export function codexModel(): { model: string | null; effort: string | null } {
  const p = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "config.toml");
  if (!existsSync(p)) return { model: null, effort: null };
  const t = readFileSync(p, "utf8");
  return { model: /^\s*model\s*=\s*"([^"]+)"/m.exec(t)?.[1] ?? null, effort: /^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m.exec(t)?.[1] ?? null };
}

export function isPremiumModel(model: string | null, re: RegExp = process.env.COMD_PREMIUM_MODELS ? new RegExp(process.env.COMD_PREMIUM_MODELS, "i") : DEFAULT_PREMIUM_MODEL_RE): boolean {
  return !!model && re.test(model);
}

function premiumRe(): RegExp {
  return process.env.COMD_PREMIUM_MODELS ? new RegExp(process.env.COMD_PREMIUM_MODELS, "i") : DEFAULT_PREMIUM_MODEL_RE;
}

/**
 * The mock runtime (tests, demos, e2e) advertises COMD_MOCK_MODEL / COMD_MOCK_EFFORT like a real one.
 * COMD_MOCK_AS=claude|codex makes it advertise that runtime name, so Chambers applies the real premium rule
 * (model + effort) instead of trusting the mock's flag; the work itself is still the mock's.
 */
export function mockRuntimeInfo(env = process.env): RuntimeInfo {
  const forced = env.COMD_MOCK_PREMIUM === "1";
  const as = env.COMD_MOCK_AS === "claude" || env.COMD_MOCK_AS === "codex" ? env.COMD_MOCK_AS : null;
  const model = env.COMD_MOCK_MODEL ?? (forced ? "mock-premium" : "mock");
  const effort = env.COMD_MOCK_EFFORT ?? (forced ? "high" : null);
  return { name: as ?? "mock", version: as ? `mock (as ${as})` : "mock", model, effort, premium: (forced && !as) || isPremiumRuntime({ model, effort }, premiumRe()) };
}

export async function detectRuntime(name: "claude" | "codex" | "mock", o: { model?: string | null; effort?: string | null } = {}): Promise<RuntimeInfo | null> {
  if (name === "mock") return mockRuntimeInfo();
  const v = await run(name, ["--version"]);
  if (!v) return null;
  const m = name === "claude" ? claudeModel() : codexModel();
  const model = o.model ?? process.env.COMD_MODEL ?? m.model;
  const effort = o.effort ?? process.env.COMD_EFFORT ?? m.effort;
  // premium = top-tier model AND high effort (Claude Code's default model alone does not qualify; say so explicitly)
  return { name, version: firstVersion(v), model, effort, premium: isPremiumRuntime({ model, effort }, premiumRe()) };
}

export async function detectTools(): Promise<ToolInfo> {
  const [forge, docker, magick, convert, ffmpeg, sox] = await Promise.all([
    run("forge", ["--version"]), run("docker", ["--version"]), run("magick", ["-version"]), run("convert", ["-version"]), run("ffmpeg", ["-version"]), run("sox", ["--version"]),
  ]);
  return { foundry: !!forge, docker: !!docker, image: !!(magick || convert || process.env.COMD_IMAGE_TOOL), audio: !!(ffmpeg || sox || process.env.COMD_AUDIO_TOOL), video: !!(ffmpeg || process.env.COMD_VIDEO_TOOL), node: process.versions.node };
}

/** Default runtime: Claude Code if installed, else Codex. */
export async function defaultRuntime(): Promise<"claude" | "codex" | null> {
  if (await run("claude", ["--version"])) return "claude";
  if (await run("codex", ["--version"])) return "codex";
  return null;
}
