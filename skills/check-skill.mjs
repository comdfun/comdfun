#!/usr/bin/env node
// check-skill.mjs: structural checker for Company.md's skill catalog. Node 22+, no dependencies.
//
//   node skills/check-skill.mjs                 check every skills/<id>/SKILL.md and that index.json is current
//   node skills/check-skill.mjs skills/foo      check one skill folder (or a SKILL.md path)
//   node skills/check-skill.mjs --write-index   check everything, then regenerate skills/index.json
//   node skills/check-skill.mjs --json          machine-readable report
//
// It checks structure, not quality: a skill can pass here and still be a poor skill. The human
// checklist in skills/README.md covers the rest.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const KINDS = ["runnable", "reference"];
export const ROLES = ["implement", "review", "tests", "integrate", "reference"];
export const INFERENCE = ["economy", "standard", "premium"];
export const JUDGES = ["verifier-rerun", "verifier-paths"];
export const REQUIRES = ["network", "tool:image", "tool:audio", "tool:video"];
export const WRITES = ["any", "paths", "none"];
export const ORIGINS = ["parity", "comd"];
// Must match CHECK_IDS in packages/services/src/skills.ts (the Clerk implements each one).
export const CHECK_IDS = [
  "paths", "no-writes", "outputs", "foundry-build", "foundry-test", "foundry-sizes", "foundry-script",
  "project-build", "web-build", "site-screen", "npm-check", "indexer", "research-citations", "media-image",
  "media-audio", "media-video", "review-report", "site-verdict", "workflow-plan", "oracle-answer",
  "findings-response", "gas-report", "readme", "launch-manifest",
];
const RUNNABLE_SECTIONS = ["Purpose", "Inputs", "Procedure", "Outputs", "Acceptance checks", "Stop and report"];
const REFERENCE_SECTIONS = ["Purpose", "How to apply", "Sources and freshness"];
const REQUIRED_KEYS = ["id", "version", "kind", "origin", "role", "inference", "tier", "judge", "requires", "writes", "checks", "outputs", "description"];
const OPTIONAL_KEYS = ["references", "reads", "variables", "topics"];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MEDIA_RE = /^[a-z]+\/[a-z0-9.+-]+$/;

// ---------------------------------------------------------------------------------------------
// Frontmatter: a strict YAML subset (scalars, inline [lists], block lists of scalars or flat maps)
// ---------------------------------------------------------------------------------------------

function scalar(raw) {
  const v = raw.trim();
  if (v === "") return "";
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  if (v === "none" || v === "null" || v === "~") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) => scalar(s));
  }
  return v;
}

export function parseFrontmatter(text) {
  const errors = [];
  if (!text.startsWith("---\n")) return { data: null, body: text, errors: ["file must start with a --- frontmatter block"] };
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return { data: null, body: text, errors: ["frontmatter is not closed with ---"] };
  const lines = text.slice(4, end).split("\n");
  const body = text.slice(end + 5);
  const data = {};
  let current = null; // key holding a block list
  for (const [i, line] of lines.entries()) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const top = /^([A-Za-z][A-Za-z0-9_-]*):(.*)$/.exec(line);
    if (top) {
      const [, key, rest] = top;
      if (key in data) errors.push(`frontmatter line ${i + 1}: duplicate key ${key}`);
      if (rest.trim() === "") {
        data[key] = [];
        current = key;
      } else {
        data[key] = scalar(rest);
        current = null;
      }
      continue;
    }
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && current) {
      const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(item[1]);
      data[current].push(kv ? { [kv[1]]: scalar(kv[2]) } : scalar(item[1]));
      continue;
    }
    const cont = /^\s{4,}([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (cont && current && data[current].length && typeof data[current].at(-1) === "object" && data[current].at(-1) !== null) {
      data[current].at(-1)[cont[1]] = scalar(cont[2]);
      continue;
    }
    errors.push(`frontmatter line ${i + 1}: cannot parse "${line}"`);
  }
  return { data, body, errors };
}

function sections(body) {
  const out = new Map();
  const re = /^## (.+)$/gm;
  const heads = [...body.matchAll(re)];
  for (const [i, m] of heads.entries()) {
    const start = m.index + m[0].length;
    const stop = i + 1 < heads.length ? heads[i + 1].index : body.length;
    out.set(m[1].trim(), body.slice(start, stop));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------------------------

export function checkSkill(dir, catalogIds = null, referenceIds = null) {
  const errors = [];
  const warnings = [];
  const file = path.join(dir, "SKILL.md");
  const folder = path.basename(dir);
  if (!existsSync(file)) return { id: folder, errors: ["SKILL.md missing"], warnings, meta: null };
  const text = readFileSync(file, "utf8");
  const { data: fm, body, errors: fmErrors } = parseFrontmatter(text);
  errors.push(...fmErrors);
  if (!fm) return { id: folder, errors, warnings, meta: null };

  for (const k of REQUIRED_KEYS) if (!(k in fm)) errors.push(`frontmatter: missing ${k}`);
  for (const k of Object.keys(fm)) if (!REQUIRED_KEYS.includes(k) && !OPTIONAL_KEYS.includes(k)) errors.push(`frontmatter: unknown key ${k}`);

  if (fm.writes === null) fm.writes = "none"; // `none` is also the YAML-subset null
  const id = fm.id;
  if (typeof id !== "string" || !ID_RE.test(id)) errors.push("id must match ^[a-z0-9][a-z0-9-]{0,63}$");
  if (id !== folder) errors.push(`id ${id} does not match folder ${folder}`);
  if (!Number.isInteger(fm.version) || fm.version < 1) errors.push("version must be a positive integer");
  if (!KINDS.includes(fm.kind)) errors.push(`kind must be one of ${KINDS.join("|")}`);
  if (!ORIGINS.includes(fm.origin)) errors.push(`origin must be one of ${ORIGINS.join("|")}`);
  if (!ROLES.includes(fm.role)) errors.push(`role must be one of ${ROLES.join("|")}`);
  if (!Array.isArray(fm.requires)) errors.push("requires must be a list");
  else for (const r of fm.requires) if (!REQUIRES.includes(r)) errors.push(`requires: unknown ${r}`);
  if (!WRITES.includes(fm.writes)) errors.push(`writes must be one of ${WRITES.join("|")}`);
  if (!Array.isArray(fm.checks)) errors.push("checks must be a list");
  else for (const c of fm.checks) if (!CHECK_IDS.includes(c)) errors.push(`checks: unknown check id ${c}`);
  if (!Array.isArray(fm.outputs)) errors.push("outputs must be a list");
  const desc = fm.description;
  if (typeof desc !== "string" || desc.length < 20 || desc.length > 200) errors.push("description must be 20-200 characters");
  else if (!/[.]$/.test(desc)) errors.push("description must be one sentence ending in a period");

  if (fm.kind === "reference") {
    if (fm.role !== "reference") errors.push("reference skills have role: reference");
    if (fm.inference !== null) errors.push("reference skills have inference: none");
    if (fm.tier !== null) errors.push("reference skills have tier: none");
    if (fm.judge !== null) errors.push("reference skills have judge: none");
    if (fm.writes !== "none") errors.push("reference skills have writes: none");
    if (Array.isArray(fm.checks) && fm.checks.length) errors.push("reference skills have checks: []");
    if (Array.isArray(fm.outputs) && fm.outputs.length) errors.push("reference skills have outputs: []");
    if (Array.isArray(fm.requires) && fm.requires.length) errors.push("reference skills have requires: []");
  } else if (fm.kind === "runnable") {
    if (fm.role === "reference") errors.push("runnable skills need a working role");
    if (!INFERENCE.includes(fm.inference)) errors.push(`inference must be one of ${INFERENCE.join("|")}`);
    if (fm.tier !== 1 && fm.tier !== 2) errors.push("tier must be 1 or 2");
    if (!JUDGES.includes(fm.judge)) errors.push(`judge must be one of ${JUDGES.join("|")}`);
    if (fm.tier === 1 && fm.judge !== "verifier-rerun") errors.push("tier 1 skills are judged verifier-rerun");
    if (fm.tier === 2 && fm.judge !== "verifier-paths") errors.push("tier 2 skills are judged verifier-paths");
    if (Array.isArray(fm.checks)) {
      if (!fm.checks.length) errors.push("runnable skills declare at least one check");
      if (fm.writes === "none" && !fm.checks.includes("no-writes")) errors.push("writes: none requires the no-writes check");
      if (fm.writes !== "none" && !fm.checks.includes("paths")) errors.push(`writes: ${fm.writes} requires the paths check`);
      if (fm.role === "review" && fm.writes !== "none") errors.push("review skills write nothing (writes: none)");
      if (new Set(fm.checks).size !== fm.checks.length) errors.push("checks has duplicates");
    }
    if (Array.isArray(fm.outputs)) {
      for (const [i, o] of fm.outputs.entries()) {
        if (!o || typeof o !== "object") {
          errors.push(`outputs[${i}] must be a map`);
          continue;
        }
        if (typeof o.path !== "string" || !o.path.startsWith("artifacts/") || o.path.includes("..")) errors.push(`outputs[${i}].path must be under artifacts/`);
        if (typeof o.mediaType !== "string" || !MEDIA_RE.test(o.mediaType)) errors.push(`outputs[${i}].mediaType invalid`);
        if (typeof o.required !== "boolean") errors.push(`outputs[${i}].required must be true or false`);
        if (typeof o.path === "string" && !body.includes(o.path)) errors.push(`outputs[${i}].path ${o.path} is never mentioned in the body`);
      }
    }
  }
  for (const key of ["references", "reads", "variables", "topics"]) {
    if (key in fm && !Array.isArray(fm[key])) errors.push(`${key} must be a list`);
  }
  if (Array.isArray(fm.references) && referenceIds) {
    for (const r of fm.references) if (!referenceIds.has(r)) errors.push(`references: ${r} is not a reference skill in the catalog`);
  }

  // body
  const firstLine = body.split("\n").find((l) => l.trim());
  if (!firstLine || !firstLine.startsWith("# ")) errors.push("body must start with a '# Title' line");
  const secs = sections(body);
  const required = fm.kind === "reference" ? REFERENCE_SECTIONS : RUNNABLE_SECTIONS;
  for (const s of required) if (!secs.has(s)) errors.push(`missing section "## ${s}"`);
  if (fm.kind === "reference" && secs.size < REFERENCE_SECTIONS.length + 3) errors.push("reference skills carry at least three knowledge sections besides the required ones");
  const minLen = fm.kind === "reference" ? 3000 : 1500;
  if (body.length < minLen) errors.push(`body is ${body.length} characters; ${fm.kind} skills need at least ${minLen}`);
  if (/\b(TODO|TBD|FIXME|XXX)\b|lorem ipsum/i.test(body)) errors.push("body contains a placeholder (TODO/TBD/FIXME/XXX/lorem)");
  if (/\bimd\b|identity\.md|\.imd\//i.test(text)) errors.push("skills are written for Company.md; do not reference another network's names or paths");
  if (fm.kind === "runnable" && secs.has("Acceptance checks")) {
    const acc = secs.get("Acceptance checks");
    const items = acc.split("\n").filter((l) => /^\d+\.\s/.test(l));
    if (items.length < 3) errors.push("Acceptance checks must be a numbered list of at least 3 items");
    if (Array.isArray(fm.checks)) {
      for (const c of fm.checks) if (!acc.includes(`\`${c}\``)) errors.push(`Acceptance checks never name the Clerk check \`${c}\``);
    }
  }
  if (fm.kind === "runnable" && secs.has("Procedure")) {
    const steps = secs.get("Procedure").split("\n").filter((l) => /^\d+\.\s/.test(l));
    if (steps.length < 3) errors.push("Procedure must be a numbered list of at least 3 steps");
  }
  if (fm.kind === "reference" && secs.has("Sources and freshness") && !/\d{4}/.test(secs.get("Sources and freshness"))) {
    warnings.push("Sources and freshness should date the knowledge (a year)");
  }

  const sha256 = createHash("sha256").update(text).digest("hex");
  const meta = errors.length
    ? null
    : {
        id: fm.id,
        version: fm.version,
        kind: fm.kind,
        origin: fm.origin,
        role: fm.role,
        inference: fm.inference ?? "none",
        tier: fm.tier,
        judge: fm.judge ?? "none",
        requires: fm.requires,
        writes: fm.writes,
        checks: fm.checks,
        outputs: fm.outputs,
        references: fm.references ?? [],
        description: fm.description,
        sha256,
        bytes: Buffer.byteLength(text),
      };
  return { id: fm.id ?? folder, errors, warnings, meta };
}

function listSkillDirs() {
  return readdirSync(SKILLS_DIR)
    .filter((n) => !n.startsWith(".") && statSync(path.join(SKILLS_DIR, n)).isDirectory())
    .sort()
    .map((n) => path.join(SKILLS_DIR, n));
}

function buildIndex(results) {
  const skills = {};
  for (const r of results) skills[r.meta.id] = r.meta;
  return { version: 1, generatedFrom: "skills/*/SKILL.md via skills/check-skill.mjs --write-index", count: results.length, skills };
}

function main() {
  const args = process.argv.slice(2);
  const writeIndex = args.includes("--write-index");
  const asJson = args.includes("--json");
  const targets = args.filter((a) => !a.startsWith("--"));
  const all = listSkillDirs();
  // first pass: learn which ids are reference skills (for references: validation)
  const referenceIds = new Set();
  for (const d of all) {
    try {
      const { data } = parseFrontmatter(readFileSync(path.join(d, "SKILL.md"), "utf8"));
      if (data?.kind === "reference") referenceIds.add(data.id);
    } catch {
      /* reported below */
    }
  }
  const dirs = targets.length ? targets.map((t) => path.resolve(t.endsWith("SKILL.md") ? path.dirname(t) : t)) : all;
  const results = dirs.map((d) => checkSkill(d, null, referenceIds));
  let failed = results.filter((r) => r.errors.length);

  const indexPath = path.join(SKILLS_DIR, "index.json");
  let indexProblem = null;
  if (!targets.length && !failed.length) {
    const next = JSON.stringify(buildIndex(results), null, 2) + "\n";
    if (writeIndex) writeFileSync(indexPath, next);
    else if (!existsSync(indexPath) || readFileSync(indexPath, "utf8") !== next) indexProblem = "skills/index.json is stale; run: node skills/check-skill.mjs --write-index";
  }

  if (asJson) {
    console.log(JSON.stringify({ ok: !failed.length && !indexProblem, checked: results.length, indexProblem, results: results.map(({ id, errors, warnings }) => ({ id, errors, warnings })) }, null, 2));
  } else {
    for (const r of results) {
      const tag = r.errors.length ? "FAIL" : "ok  ";
      console.log(`${tag} ${r.id}${r.warnings.length ? `  (${r.warnings.length} warning)` : ""}`);
      for (const e of r.errors) console.log(`       - ${e}`);
      for (const w of r.warnings) console.log(`       ~ ${w}`);
    }
    const runnable = results.filter((r) => r.meta?.kind === "runnable").length;
    const reference = results.filter((r) => r.meta?.kind === "reference").length;
    console.log(`\n${results.length} skill(s) checked: ${results.length - failed.length} passed, ${failed.length} failed (${runnable} runnable, ${reference} reference)`);
    if (indexProblem) console.log(indexProblem);
    else if (writeIndex && !failed.length && !targets.length) console.log("wrote skills/index.json");
  }
  process.exit(failed.length || indexProblem ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
