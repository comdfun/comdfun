/**
 * Skill catalog: `skills/index.json` + `skills/<id>/SKILL.md` (SKILLS_DIR, default <repo>/skills). That catalog is the
 * source of truth for GET /skills, /reads/skill/:id, planning and dispatch. The protocol's built-in table is used
 * only when no catalog can be found (and /health then reports `skills_builtin`).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_SKILLS, sha256Hex, type SkillInfo } from "@company/protocol";

export interface CatalogSkill extends SkillInfo {
  version: number;
  checks: string[];
  outputs: { name?: string; path: string; mediaType: string }[];
  hash: string;
  upstream: string | null;
  licence: string | null;
}

export class SkillCatalog {
  readonly skills = new Map<string, CatalogSkill>();
  readonly dir: string | null;
  source: "catalog" | "builtin" = "builtin";

  constructor(dir: string | null) {
    this.dir = dir;
    const builtin = () => {
      for (const s of BUILTIN_SKILLS) this.skills.set(s.id, { ...s, version: 1, checks: [], outputs: [], hash: sha256Hex(JSON.stringify(s)), upstream: null, licence: null });
    };
    const index = dir ? path.join(dir, "index.json") : null;
    if (!index || !existsSync(index)) {
      console.warn(`[skills] no skills/index.json${dir ? ` in ${dir}` : ""}; using the built-in table (set SKILLS_DIR)`);
      builtin();
    } else {
      try {
        const raw = JSON.parse(readFileSync(index, "utf8"));
        const list: any[] = Array.isArray(raw.skills) ? raw.skills : Object.values(raw.skills ?? {});
        for (const m of list) {
          if (!m?.id) continue;
          const base = BUILTIN_SKILLS.find((b) => b.id === m.id);
          const role = (m.kind === "reference" ? "reference" : m.role ?? base?.role ?? "implement") as SkillInfo["role"];
          this.skills.set(m.id, {
            id: m.id,
            role,
            inference: role === "reference" ? null : m.inference && m.inference !== "none" ? m.inference : base?.inference ?? "standard",
            tier: role === "reference" ? null : m.tier ?? base?.tier ?? 2,
            requires: m.requires ?? base?.requires ?? [],
            writes: m.writes ?? base?.writes ?? "any",
            description: m.description ?? base?.description ?? "",
            version: Number(m.version ?? 1),
            checks: m.checks ?? [],
            outputs: m.outputs ?? [],
            hash: m.sha256 ?? m.hash ?? "",
            upstream: m.upstream ?? null,
            licence: m.licence ?? m.license ?? null,
          });
        }
        this.source = "catalog";
      } catch (e) {
        console.warn(`[skills] could not read ${index}: ${(e as Error).message}; using the built-in table`);
        this.skills.clear();
        builtin();
      }
    }
  }

  get(id: string): CatalogSkill | undefined {
    return this.skills.get(id);
  }
  runnable(id: string): boolean {
    const s = this.skills.get(id);
    return !!s && s.role !== "reference";
  }
  reference(id: string): boolean {
    return this.skills.get(id)?.role === "reference";
  }
  all(): CatalogSkill[] {
    return [...this.skills.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  markdown(id: string): string | null {
    if (!this.dir) return null;
    const p = path.join(this.dir, id, "SKILL.md");
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  }
}

export function defaultSkillsDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const p of [path.resolve(here, "..", "..", "..", "skills"), path.resolve(process.cwd(), "skills")]) if (existsSync(p)) return p;
  return null;
}
