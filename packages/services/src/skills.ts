/**
 * Skill catalog types and loader. The catalog's source of truth is `skills/<id>/SKILL.md`
 * frontmatter; `skills/index.json` is generated from it by `node skills/check-skill.mjs --write-index`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SkillKind = "runnable" | "reference";
export type SkillRole = "implement" | "review" | "tests" | "integrate" | "reference";
export type InferenceTier = "economy" | "standard" | "premium" | "none";
export type SkillRequirement = "network" | "tool:image" | "tool:audio" | "tool:video";

/** Structural check ids the Clerk implements (see verifier.ts). */
export const CHECK_IDS = [
  "paths",
  "no-writes",
  "outputs",
  "foundry-build",
  "foundry-test",
  "foundry-sizes",
  "foundry-script",
  "project-build",
  "web-build",
  "site-screen",
  "npm-check",
  "indexer",
  "research-citations",
  "media-image",
  "media-audio",
  "media-video",
  "review-report",
  "site-verdict",
  "workflow-plan",
  "oracle-answer",
  "findings-response",
  "gas-report",
  "readme",
  "launch-manifest",
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export interface DeclaredOutput {
  name?: string;
  path: string;
  mediaType: string;
  required?: boolean;
}

export interface SkillMeta {
  id: string;
  version: number;
  kind: SkillKind;
  role: SkillRole;
  inference: InferenceTier;
  /** 1 = Clerk re-runs the suite; 2 = Clerk checks fixed output paths; null for references */
  tier: 1 | 2 | null;
  judge: "verifier-rerun" | "verifier-paths" | "none";
  requires: SkillRequirement[];
  /** any = may write anywhere; paths = the step must declare paths; none = artifacts/ only */
  writes: "any" | "paths" | "none";
  checks: CheckId[];
  outputs: DeclaredOutput[];
  description: string;
  /** parity = same id as the IMD catalog (our own text); comd = Company.md's own */
  origin?: "parity" | "comd";
  /** suggested reference skills */
  references?: string[];
  sha256?: string;
  bytes?: number;
}

export interface SkillCatalog {
  version: number;
  generatedFrom: string;
  count: number;
  skills: Record<string, SkillMeta>;
}

/** Default location: `<repo>/skills`, overridable with SKILLS_DIR. */
export function defaultSkillsDir(env: Record<string, string | undefined> = process.env): string {
  if (env.SKILLS_DIR) return path.resolve(env.SKILLS_DIR);
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "skills");
}

const cache = new Map<string, SkillCatalog>();

export async function loadSkillCatalog(dir: string = defaultSkillsDir()): Promise<SkillCatalog> {
  const hit = cache.get(dir);
  if (hit) return hit;
  const raw = JSON.parse(await readFile(path.join(dir, "index.json"), "utf8")) as SkillCatalog;
  cache.set(dir, raw);
  return raw;
}

export async function getSkill(id: string, dir?: string): Promise<SkillMeta> {
  const cat = await loadSkillCatalog(dir);
  const s = cat.skills[id];
  if (!s) throw new Error(`unknown skill: ${id}`);
  return s;
}

/** Read a SKILL.md body (for handing to a seat with its assignment). */
export async function readSkillMarkdown(id: string, dir: string = defaultSkillsDir()): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error(`invalid skill id: ${id}`);
  return readFile(path.join(dir, id, "SKILL.md"), "utf8");
}
