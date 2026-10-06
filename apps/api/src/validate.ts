/**
 * Input validation for every paid action. Returns `problems` (never throws); a non-empty list means 422
 * invalid_input and nothing is charged. Limits follow IMD's documented job/workflow/oracle/schedule bodies.
 */
import {
  ANSWER_TYPES, LAUNCH_KINDS, LIMITS, SHAPES, SITE_LABEL_RE, STEP_KEY_RE, TEMPLATES, UUID_RE, type Problem,
} from "@company/protocol";
import type { SkillCatalog } from "./skills.ts";
import { parseCadence } from "./cadence.ts";

export class Problems {
  readonly list: Problem[] = [];
  add(path: string, code: string, message: string) {
    this.list.push({ path, code, message });
  }
  get ok() { return this.list.length === 0; }
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown, min = 1, max = Infinity) => typeof v === "string" && v.length >= min && v.length <= max;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

function unknownKeys(p: Problems, o: Record<string, unknown>, allowed: string[], path: string) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) p.add(`${path}${path ? "." : ""}${k}`, "unknown_field", `${k} is not a recognised field`);
}

const JOB_FIELDS = [
  "objective", "skill", "template", "shape", "steps", "references", "repoUrl", "baseCommit", "contracts", "paths", "inputs", "outputs", "github",
  "ipfs", "onchain", "owner", "chainId", "pairWith", "economics", "projectPath", "runs", "rubric", "panelSize", "panelQuorum", "minCitations", "parentJobId",
];
const STEP_FIELDS = ["skill", "key", "dependsOn", "objective", "acceptanceCriteria", "paths", "references", "inputs", "outputs", "variables"];

export interface JobCheckOpts {
  action: "job.open" | "launch.open" | "job.continue" | "schedule" | "workflow";
  skills: SkillCatalog;
  launchChains: number[];
  launchKindsFor: (chainId: number) => string[];
  pairingsFor: (chainId: number) => string[];
}

function checkFiles(p: Problems, v: unknown, path: string, kind: "inputs" | "outputs") {
  if (v === undefined) return;
  if (!Array.isArray(v) || v.length > 32) return p.add(path, "invalid", `${kind} must be an array of at most 32`);
  v.forEach((f, i) => {
    const at = `${path}[${i}]`;
    if (!isObj(f)) return p.add(at, "invalid", "must be an object");
    if (kind === "inputs") {
      unknownKeys(p, f, ["name", "path", "hash", "mediaType", "bytes", "submissionHash", "url"], at);
      if (!isStr(f.name, 1, 64)) p.add(`${at}.name`, "invalid", "name required (≤64)");
      if (!isStr(f.path, 1, 512)) p.add(`${at}.path`, "invalid", "path required (≤512)");
      if (typeof f.hash !== "string" || !HEX64.test(f.hash)) p.add(`${at}.hash`, "invalid", "hash must be 64 lowercase hex");
      if (!isStr(f.mediaType, 1, 128)) p.add(`${at}.mediaType`, "invalid", "mediaType required");
      if (!Number.isInteger(f.bytes) || f.bytes < 0) p.add(`${at}.bytes`, "invalid", "bytes must be a non-negative integer");
      if (typeof f.submissionHash !== "string" || !HEX64.test(f.submissionHash)) p.add(`${at}.submissionHash`, "invalid", "submissionHash must be 64 lowercase hex");
    } else {
      unknownKeys(p, f, ["name", "path", "mediaType"], at);
      if (!isStr(f.name, 1, 64)) p.add(`${at}.name`, "invalid", "name required (≤64)");
      if (!isStr(f.path, 1, 512) || !String(f.path).startsWith("artifacts/") || String(f.path).includes("..")) p.add(`${at}.path`, "invalid", "path must be under artifacts/");
      if (!isStr(f.mediaType, 1, 128)) p.add(`${at}.mediaType`, "invalid", "mediaType required");
    }
  });
}

function checkRefs(p: Problems, v: unknown, path: string, skills: SkillCatalog) {
  if (v === undefined) return;
  if (!Array.isArray(v) || v.length > 8) return p.add(path, "invalid", "references must be an array of at most 8 reference skills");
  v.forEach((r, i) => { if (typeof r !== "string" || !skills.reference(r)) p.add(`${path}[${i}]`, "unknown_reference", `${String(r)} is not a reference skill`); });
}

function checkPaths(p: Problems, v: unknown, path: string, max = 16) {
  if (v === undefined) return;
  if (!Array.isArray(v) || v.length > max) return p.add(path, "invalid", `at most ${max} paths`);
  v.forEach((x, i) => { if (!isStr(x, 1, 512) || String(x).startsWith("/") || String(x).split("/").includes("..")) p.add(`${path}[${i}]`, "invalid", "relative repository path (≤512, no ..)"); });
}

export function validateJobBody(body: unknown, o: JobCheckOpts, path = ""): Problem[] {
  const p = new Problems();
  const at = (k: string) => (path ? `${path}.${k}` : k);
  if (!isObj(body)) {
    p.add(path || "input", "invalid", "job body must be an object");
    return p.list;
  }
  unknownKeys(p, body, JOB_FIELDS, path);
  const research = body.template === "research";
  if (!isStr(body.objective, 1, research ? 4000 : 8000)) p.add(at("objective"), "invalid", `objective is required, 1–${research ? 4000 : 8000} characters`);

  const modes = ["skill", "template", "steps"].filter((k) => body[k] !== undefined);
  if (modes.length > 1) p.add(at(modes[1]), "conflict", `${modes.join(" and ")} cannot be combined`);
  if (modes.length === 0 && o.action !== "job.continue") p.add(at("skill"), "required", "one of skill, template or steps is required");

  if (body.skill !== undefined) {
    if (!isStr(body.skill, 1, 64) || !o.skills.runnable(body.skill)) p.add(at("skill"), "unknown_skill", `${String(body.skill)} is not a runnable skill`);
    else if (o.skills.get(body.skill)?.writes === "paths" && !Array.isArray(body.paths)) p.add(at("paths"), "required", `${body.skill} writes only declared paths; give paths`);
  }
  if (body.template !== undefined && !(TEMPLATES as readonly string[]).includes(body.template)) p.add(at("template"), "invalid", `template must be one of ${TEMPLATES.join(", ")}`);
  if (body.steps !== undefined) {
    if (!(SHAPES as readonly string[]).includes(body.shape)) p.add(at("shape"), "required", `shape (${SHAPES.join(", ")}) is required with steps`);
    if (!Array.isArray(body.steps) || body.steps.length < 1 || body.steps.length > 6) p.add(at("steps"), "invalid", "steps must hold 1–6 steps");
    else {
      const keys = new Set<string>();
      body.steps.forEach((s: any, i: number) => {
        const sp = at(`steps[${i}]`);
        if (!isObj(s)) return p.add(sp, "invalid", "step must be an object");
        unknownKeys(p, s, STEP_FIELDS, sp);
        if (!isStr(s.skill, 1, 64) || !o.skills.runnable(s.skill)) p.add(`${sp}.skill`, "unknown_skill", `${String(s.skill)} is not a runnable skill`);
        else if (o.skills.get(s.skill)?.writes === "paths" && !Array.isArray(s.paths) && !Array.isArray(body.paths)) p.add(`${sp}.paths`, "required", `${s.skill} writes only declared paths; give paths`);
        if (s.key !== undefined) {
          if (typeof s.key !== "string" || !STEP_KEY_RE.test(s.key)) p.add(`${sp}.key`, "invalid", "key must match ^[a-z][a-z0-9_]{0,31}$");
          else if (keys.has(s.key)) p.add(`${sp}.key`, "duplicate", "duplicate step key");
          else keys.add(s.key);
        } else if (body.shape === "dag") p.add(`${sp}.key`, "required", "dag steps need a key");
        if (s.dependsOn !== undefined && (!Array.isArray(s.dependsOn) || s.dependsOn.length > 6 || s.dependsOn.some((d: unknown) => typeof d !== "string"))) p.add(`${sp}.dependsOn`, "invalid", "dependsOn: up to 6 step keys");
        if (body.shape === "dag" && !Array.isArray(s.dependsOn)) p.add(`${sp}.dependsOn`, "required", "dag steps need dependsOn ([] for roots)");
        if (body.shape !== "dag" && s.dependsOn !== undefined) p.add(`${sp}.dependsOn`, "invalid", "dependsOn is only for shape dag");
        if (s.objective !== undefined && !isStr(s.objective, 1, 3000)) p.add(`${sp}.objective`, "invalid", "objective 1–3000 characters");
        if (s.acceptanceCriteria !== undefined && (!Array.isArray(s.acceptanceCriteria) || s.acceptanceCriteria.length < 1 || s.acceptanceCriteria.length > 8 || s.acceptanceCriteria.some((c: unknown) => !isStr(c, 1, 500)))) p.add(`${sp}.acceptanceCriteria`, "invalid", "1–8 criteria of 1–500 characters");
        checkPaths(p, s.paths, `${sp}.paths`);
        checkRefs(p, s.references, `${sp}.references`, o.skills);
        checkFiles(p, s.inputs, `${sp}.inputs`, "inputs");
        checkFiles(p, s.outputs, `${sp}.outputs`, "outputs");
        if (s.variables !== undefined) {
          if (!isObj(s.variables)) p.add(`${sp}.variables`, "invalid", "variables must be a string map");
          else for (const [k, v] of Object.entries(s.variables)) if (!isStr(k, 1, 64) || !isStr(v, 0, 2000)) p.add(`${sp}.variables.${k}`, "invalid", "keys ≤64, values ≤2000 characters");
        }
      });
      if (body.shape === "dag" && p.ok) {
        for (const [i, s] of body.steps.entries()) for (const d of s.dependsOn ?? []) if (!keys.has(d)) p.add(at(`steps[${i}].dependsOn`), "unknown_step", `${d} is not a step key`);
        if (p.ok && hasCycle(body.steps)) p.add(at("steps"), "cycle", "steps contain a dependency cycle");
      }
    }
  } else if (body.shape !== undefined) p.add(at("shape"), "invalid", "shape is only used with steps");

  checkRefs(p, body.references, at("references"), o.skills);
  if ((body.repoUrl === undefined) !== (body.baseCommit === undefined)) p.add(at(body.repoUrl === undefined ? "repoUrl" : "baseCommit"), "required", "repoUrl and baseCommit go together");
  if (body.repoUrl !== undefined && (!isStr(body.repoUrl, 1, 512) || !/^https:\/\/[^\s]+$/.test(body.repoUrl))) p.add(at("repoUrl"), "invalid", "repoUrl must be an https URI (≤512)");
  if (body.baseCommit !== undefined && (typeof body.baseCommit !== "string" || !/^[0-9a-f]{40}$/.test(body.baseCommit))) p.add(at("baseCommit"), "invalid", "baseCommit must be 40 lowercase hex");
  if (body.contracts !== undefined && (!Array.isArray(body.contracts) || body.contracts.length > 4 || body.contracts.some((c: unknown) => !isStr(c, 1, 512)))) p.add(at("contracts"), "invalid", "contracts: up to 4 names or paths (≤512)");
  checkPaths(p, body.paths, at("paths"));
  checkFiles(p, body.inputs, at("inputs"), "inputs");
  checkFiles(p, body.outputs, at("outputs"), "outputs");
  if (body.github !== undefined && typeof body.github !== "boolean") p.add(at("github"), "invalid", "github must be a boolean");
  if (body.ipfs !== undefined && typeof body.ipfs !== "boolean" && !(typeof body.ipfs === "string" && SITE_LABEL_RE.test(body.ipfs))) p.add(at("ipfs"), "invalid", "ipfs must be a boolean or a site label ^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$");

  // launch fields
  const launchFields = ["onchain", "owner", "chainId", "pairWith", "economics"].filter((k) => body[k] !== undefined);
  if (o.action === "launch.open" || o.action === "workflow") {
    if (body.onchain === undefined) p.add(at("onchain"), "required", "launch.open needs onchain");
  } else if (launchFields.length) {
    p.add(at(launchFields[0]), "not_allowed", o.action === "job.continue" ? "continuations cannot deploy" : `${launchFields[0]} is only for launch.open`);
  }
  if (body.onchain !== undefined && body.onchain !== true && !(LAUNCH_KINDS as readonly string[]).includes(body.onchain)) p.add(at("onchain"), "invalid", `onchain must be true or one of ${LAUNCH_KINDS.join(", ")}`);
  const kind = body.onchain === true ? "evm_project" : body.onchain;
  if (body.owner !== undefined) {
    if (typeof body.owner !== "string" || !/^0x[0-9a-f]{40}$/.test(body.owner) || /^0x0{40}$/.test(body.owner)) p.add(at("owner"), "invalid", "owner must be a lowercase nonzero address");
    if (kind !== "evm_contracts") p.add(at("owner"), "not_allowed", "owner goes with onchain evm_contracts");
  }
  if (body.onchain !== undefined && (o.action === "launch.open" || o.action === "workflow")) {
    const chainId = body.chainId ?? o.launchChains[0];
    if (!o.launchChains.includes(chainId)) p.add(at("chainId"), "unsupported_chain", `chainId must be one of ${o.launchChains.join(", ")}`);
    else if (kind && !o.launchKindsFor(chainId).includes(kind)) p.add(at("onchain"), "unsupported_kind", `${kind} is not offered on chain ${chainId}`);
    if (body.pairWith !== undefined && !o.pairingsFor(chainId).includes(body.pairWith)) p.add(at("pairWith"), "unsupported_pairing", `pairWith must be one of ${o.pairingsFor(chainId).join(", ")}`);
    if (body.economics !== undefined) {
      if (!isObj(body.economics)) p.add(at("economics"), "invalid", "economics must be an object");
      else {
        unknownKeys(p, body.economics, ["poolBps", "initialMarketCapWei", "remainderTo"], at("economics"));
        const e = body.economics;
        if (e.poolBps !== undefined && (!Number.isInteger(e.poolBps) || e.poolBps < 1000 || e.poolBps > 9000)) p.add(at("economics.poolBps"), "invalid", "poolBps must be 1000–9000 (10–90% of supply seeds the pool)");
        if (e.initialMarketCapWei !== undefined && (typeof e.initialMarketCapWei !== "string" || !/^[1-9][0-9]{0,77}$/.test(e.initialMarketCapWei))) p.add(at("economics.initialMarketCapWei"), "invalid", "decimal string");
        if (e.remainderTo !== undefined && (typeof e.remainderTo !== "string" || !ADDR.test(e.remainderTo))) p.add(at("economics.remainderTo"), "invalid", "address");
      }
      if (kind === "evm_contracts") p.add(at("economics"), "not_allowed", "evm_contracts launches have no token");
    }
  }

  // template specifics
  const t = body.template;
  if (t === "fuzz") {
    if (!Number.isInteger(body.runs) || body.runs < LIMITS.fuzz.minRuns || body.runs > LIMITS.fuzz.maxRuns) p.add(at("runs"), "invalid", "runs must be 1,000–10,000,000");
    if (!Array.isArray(body.contracts) || body.contracts.length !== 1) p.add(at("contracts"), "required", "fuzz needs exactly one harness in contracts");
    if (body.projectPath !== undefined && body.projectPath !== null && !isStr(body.projectPath, 1, 512)) p.add(at("projectPath"), "invalid", "projectPath ≤512 or null");
    if (body.rubric !== undefined) checkRubric(p, body.rubric, at("rubric"));
  } else {
    if (body.runs !== undefined) p.add(at("runs"), "not_allowed", "runs is for template fuzz");
    if (body.projectPath !== undefined) p.add(at("projectPath"), "not_allowed", "projectPath is for template fuzz");
  }
  if (t === "research") {
    const size = body.panelSize ?? 1;
    const quorum = body.panelQuorum ?? Math.min(size, Math.floor(size / 2) + 1);
    if (!Number.isInteger(size) || size < 1 || size > LIMITS.research.maxPanel) p.add(at("panelSize"), "invalid", "panelSize 1–9");
    if (!Number.isInteger(quorum) || quorum < 1 || quorum > 9 || quorum > size) p.add(at("panelQuorum"), "invalid", "panelQuorum 1–9 and ≤ panelSize");
    if (body.minCitations !== undefined && (!Number.isInteger(body.minCitations) || body.minCitations < 0 || body.minCitations > LIMITS.research.maxCitations)) p.add(at("minCitations"), "invalid", "minCitations 0–20");
    if (body.rubric !== undefined) checkRubric(p, body.rubric, at("rubric"));
  } else {
    for (const k of ["panelSize", "panelQuorum"]) if (body[k] !== undefined) p.add(at(k), "not_allowed", `${k} is for template research`);
    if (body.minCitations !== undefined && body.skill !== "research-report") p.add(at("minCitations"), "not_allowed", "minCitations is for research");
    if (body.rubric !== undefined && t !== "fuzz") p.add(at("rubric"), "not_allowed", "rubric is for research or fuzz");
  }
  if (t === "audit") {
    if (body.repoUrl === undefined) p.add(at("repoUrl"), "required", "audit needs repoUrl and baseCommit");
    if (body.ipfs !== undefined && body.ipfs !== false) p.add(at("ipfs"), "not_allowed", "audit refuses hosting");
    if (body.onchain !== undefined) p.add(at("onchain"), "not_allowed", "audit refuses onchain");
  }
  if ((t === "impl_tests" || t === "impl_tests_review" || t === "multi_contract") && (!Array.isArray(body.contracts) || body.contracts.length < 1)) p.add(at("contracts"), "required", `${t} needs contracts`);

  // continuation & schedule rules
  if (o.action === "job.continue") {
    if (typeof body.parentJobId !== "string" || !UUID_RE.test(body.parentJobId)) p.add(at("parentJobId"), "required", "parentJobId (the project's newest job) is required");
    for (const k of ["repoUrl", "baseCommit", "projectId", "deploymentLaunchId"]) if (body[k] !== undefined) p.add(at(k), "not_allowed", `${k} is refused on a continuation`);
  } else if (body.parentJobId !== undefined) p.add(at("parentJobId"), "not_allowed", "parentJobId is only for job.continue");
  if (o.action === "schedule" && body.onchain !== undefined) p.add(at("onchain"), "not_allowed", "schedules cannot deploy");
  return p.list;
}

function checkRubric(p: Problems, r: unknown, path: string) {
  if (!isObj(r)) return p.add(path, "invalid", "rubric must be an object");
  unknownKeys(p, r, ["contains", "mayNotRestOn"], path);
  if (!Array.isArray(r.contains) || r.contains.length < 1 || r.contains.length > 8 || r.contains.some((c: unknown) => !isStr(c, 1, 500))) p.add(`${path}.contains`, "invalid", "1–8 strings (≤500)");
  if (r.mayNotRestOn !== undefined && (!Array.isArray(r.mayNotRestOn) || r.mayNotRestOn.length > 8 || r.mayNotRestOn.some((c: unknown) => !isStr(c, 1, 200)))) p.add(`${path}.mayNotRestOn`, "invalid", "up to 8 strings (≤200)");
}

function hasCycle(steps: { key: string; dependsOn?: string[] }[]): boolean {
  const deps = new Map(steps.map((s) => [s.key, s.dependsOn ?? []]));
  const state = new Map<string, number>();
  const visit = (k: string): boolean => {
    if (state.get(k) === 1) return true;
    if (state.get(k) === 2) return false;
    state.set(k, 1);
    for (const d of deps.get(k) ?? []) if (visit(d)) return true;
    state.set(k, 2);
    return false;
  };
  return steps.some((s) => visit(s.key));
}

// ------------------------------------------------------------------------------------------ workflow

export function validateWorkflowBody(body: unknown, o: Omit<JobCheckOpts, "action">): Problem[] {
  const p = new Problems();
  if (!isObj(body)) return [{ path: "input", code: "invalid", message: "workflow body must be an object" }];
  unknownKeys(p, body, ["request", "context", "draft", "permissions"], "");
  if (!isStr(body.request, 1, 16000)) p.add("request", "required", "request is required, 1–16,000 characters");
  if (body.context !== undefined && !isStr(body.context, 0, 16000)) p.add("context", "invalid", "context ≤16,000 characters");
  if (!isObj(body.permissions)) p.add("permissions", "required", "permissions is required");
  else {
    unknownKeys(p, body.permissions, ["github", "ipfs", "onchain"], "permissions");
    const on = body.permissions.onchain;
    if (!isObj(on) || !(LAUNCH_KINDS as readonly string[]).includes(on.kind) || !Number.isInteger(on.chainId)) p.add("permissions.onchain", "required", "permissions.onchain {kind, chainId} is required");
  }
  if (!isObj(body.draft)) {
    p.add("draft", "required", "draft (a full job body) is required");
    return p.list;
  }
  p.list.push(...validateJobBody(body.draft, { ...o, action: "workflow" }, "draft"));
  const d = body.draft;
  for (const k of ["parentJobId", "projectId", "deploymentLaunchId"]) if (d[k] !== undefined) p.add(`draft.${k}`, "not_allowed", `${k} is refused in a workflow draft`);
  if (d.shape !== "chain" && d.shape !== "dag") p.add("draft.shape", "invalid", "draft shape must be chain or dag");
  if (!["evm_project", "univ4_hook", "evm_contracts"].includes(d.onchain === true ? "evm_project" : d.onchain)) p.add("draft.onchain", "invalid", "draft must launch evm_project, univ4_hook or evm_contracts");
  if (d.ipfs === undefined || d.ipfs === false) p.add("draft.ipfs", "required", "draft must host its front end (ipfs)");
  const steps: any[] = Array.isArray(d.steps) ? d.steps : [];
  const fronts = steps.filter((s) => s?.skill === "frontend-for-contract" || s?.skill === "build-website");
  if (fronts.length !== 1) p.add("draft.steps", "required", "draft needs exactly one frontend-for-contract or build-website step");
  if (!steps.some((s) => s?.skill === "adversarial-review")) p.add("draft.steps", "required", "draft needs an independent adversarial-review step");
  if (isObj(body.permissions?.onchain) && isObj(d)) {
    const kind = d.onchain === true ? "evm_project" : d.onchain;
    if (body.permissions.onchain.kind !== kind || (d.chainId ?? o.launchChains[0]) !== body.permissions.onchain.chainId) p.add("permissions.onchain", "mismatch", "permissions.onchain must match the draft's onchain and chainId");
  }
  if (Buffer.byteLength(JSON.stringify(body)) > 16 * 1024) p.add("", "too_large", "workflow body over 16 KiB");
  return p.list;
}

// ------------------------------------------------------------------------------------------ oracle

export function validateOracleBody(body: unknown, o: { rpcChains: number[] }): Problem[] {
  const p = new Problems();
  if (!isObj(body)) return [{ path: "input", code: "invalid", message: "oracle body must be an object" }];
  unknownKeys(p, body, ["v", "question", "chainId", "window", "answerType", "panelSize", "quorum", "validForSeconds", "evidence", "head", "definitions", "guards", "toleranceBps", "consumer", "allowAmbiguous", "recipe"], "");
  if (body.v !== 1) p.add("v", "required", "v must be 1");
  if (!isStr(body.question, 1, 2000)) p.add("question", "required", "question is required, 1–2,000 characters");
  if (!Number.isInteger(body.chainId) || body.chainId < 1) p.add("chainId", "required", "chainId must be a positive integer");
  else if (!o.rpcChains.includes(body.chainId)) p.add("chainId", "unsupported_chain", `no RPC configured for chain ${body.chainId}`);
  const w = body.window;
  if (!isObj(w)) p.add("window", "required", "window {hours} or {fromBlock, toBlock} is required");
  else if (w.hours !== undefined) {
    unknownKeys(p, w, ["hours"], "window");
    if (!Number.isInteger(w.hours) || w.hours < 1 || w.hours > 720) p.add("window.hours", "invalid", "hours 1–720");
  } else {
    unknownKeys(p, w, ["fromBlock", "toBlock", "toBlockHash"], "window");
    if (!Number.isInteger(w.fromBlock) || !Number.isInteger(w.toBlock) || w.fromBlock < 0 || w.toBlock < w.fromBlock) p.add("window", "invalid", "fromBlock ≤ toBlock, non-negative integers");
  }
  if (!ANSWER_TYPES.includes(body.answerType)) p.add("answerType", "invalid", `answerType must be one of ${ANSWER_TYPES.join(", ")}`);
  if (!Number.isInteger(body.panelSize) || body.panelSize < LIMITS.oracle.minPanelSize || body.panelSize > LIMITS.oracle.maxPanelSize) p.add("panelSize", "invalid", `panelSize ${LIMITS.oracle.minPanelSize}–${LIMITS.oracle.maxPanelSize}`);
  if (!Number.isInteger(body.quorum) || body.quorum < 2 || body.quorum > (body.panelSize ?? 0)) p.add("quorum", "invalid", "quorum 2 to panelSize (all quorum members must match)");
  if (!Number.isInteger(body.validForSeconds) || body.validForSeconds < 60 || body.validForSeconds > 2_592_000) p.add("validForSeconds", "invalid", "validForSeconds 60–2,592,000");
  if (body.evidence !== undefined && body.evidence !== "chain" && body.evidence !== "panel") p.add("evidence", "invalid", "evidence is chain or panel");
  if (body.head !== undefined) {
    if (!Number.isInteger(body.head) || body.head < 1 || body.head > 32) p.add("head", "invalid", "head 1–32");
    if (!String(body.answerType).endsWith("[]")) p.add("head", "not_allowed", "head is for list answers");
  }
  if (body.definitions !== undefined) {
    if (!isObj(body.definitions)) p.add("definitions", "invalid", "definitions must be a map");
    else for (const [k, v] of Object.entries(body.definitions)) if (!isStr(k, 1, 64) || !isStr(v, 1, 512)) p.add(`definitions.${k}`, "invalid", "keys 1–64, values 1–512 characters");
  }
  if (body.guards !== undefined) {
    const g = body.guards;
    if (!isObj(g)) p.add("guards", "invalid", "guards must be an object");
    else {
      unknownKeys(p, g, ["allow", "deny", "mustHaveCode", "min", "max", "sources", "minSources"], "guards");
      const word = /^0x([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
      if (g.allow !== undefined && (!Array.isArray(g.allow) || g.allow.length < 1 || g.allow.length > 256 || g.allow.some((x: unknown) => typeof x !== "string" || !word.test(x)))) p.add("guards.allow", "invalid", "1–256 addresses or bytes32");
      if (g.deny !== undefined && (!Array.isArray(g.deny) || g.deny.length < 1 || g.deny.length > 1024 || g.deny.some((x: unknown) => typeof x !== "string" || !word.test(x)))) p.add("guards.deny", "invalid", "1–1,024 addresses or bytes32");
      if (g.mustHaveCode !== undefined && typeof g.mustHaveCode !== "boolean") p.add("guards.mustHaveCode", "invalid", "boolean");
      for (const k of ["min", "max"]) if (g[k] !== undefined && (typeof g[k] !== "string" || !/^[0-9]{1,78}$/.test(g[k]))) p.add(`guards.${k}`, "invalid", "decimal string");
      if (g.sources !== undefined && (!Array.isArray(g.sources) || g.sources.length < 1 || g.sources.length > 32 || g.sources.some((x: unknown) => !isStr(x, 1, 512) || !/^https?:\/\//.test(String(x))))) p.add("guards.sources", "invalid", "1–32 URL prefixes (≤512)");
      if (g.minSources !== undefined && (!Number.isInteger(g.minSources) || g.minSources < 1 || g.minSources > 32)) p.add("guards.minSources", "invalid", "1–32");
    }
  }
  if (body.toleranceBps !== undefined) {
    if (!Number.isInteger(body.toleranceBps) || body.toleranceBps < 0 || body.toleranceBps > 10_000) p.add("toleranceBps", "invalid", "toleranceBps 0–10,000");
    if (body.answerType !== "uint256" && body.toleranceBps > 0) p.add("toleranceBps", "not_allowed", "toleranceBps is for uint256 answers");
  }
  if (body.consumer !== undefined && (!isObj(body.consumer) || !Number.isInteger(body.consumer.chainId) || typeof body.consumer.verifyingContract !== "string" || !ADDR.test(body.consumer.verifyingContract))) p.add("consumer", "invalid", "consumer {chainId, verifyingContract}");
  if (body.allowAmbiguous !== undefined && typeof body.allowAmbiguous !== "boolean") p.add("allowAmbiguous", "invalid", "boolean");
  if (body.recipe !== undefined && (!isObj(body.recipe) || typeof body.recipe.kind !== "string")) p.add("recipe", "invalid", "recipe must be {kind, ...}");
  if (p.ok && body.allowAmbiguous !== true) {
    const amb = ambiguity(body);
    if (amb) p.add("question", "ambiguous", amb);
  }
  return p.list;
}

/** A deterministic wording screen (skipped with allowAmbiguous). */
export function ambiguity(b: Record<string, any>): string | null {
  const q = String(b.question).trim();
  if (q.split(/\s+/).length < 4) return "the question is too short to have one reading; say what is measured and how";
  if (/\b(best|good|bad|should|probably|likely|opinion|feel)\b/i.test(q) && !b.definitions) return "the question asks for a judgement; pin it with definitions";
  if (b.answerType === "bool" && !/\b(is|was|did|does|has|have|were|are|will|can)\b/i.test(q)) return "a bool question should ask whether something is or was so";
  return null;
}

// ------------------------------------------------------------------------------------------ schedules

export function validateScheduleBody(body: unknown, o: JobCheckOpts & { rpcChains: number[]; floorSeconds?: number | null }): Problem[] {
  const p = new Problems();
  if (!isObj(body)) return [{ path: "input", code: "invalid", message: "schedule body must be an object" }];
  unknownKeys(p, body, ["action", "input", "cadence", "runs", "label", "continue", "startAt"], "");
  if (body.action !== "oracle.request" && body.action !== "job.open") p.add("action", "invalid", "action must be oracle.request or job.open");
  if (!Number.isInteger(body.runs) || body.runs < LIMITS.schedule.minRuns || body.runs > LIMITS.schedule.maxRuns) p.add("runs", "invalid", "runs 1–1,000,000");
  if (body.label !== undefined && !isStr(body.label, 1, 120)) p.add("label", "invalid", "label 1–120 characters");
  if (body.continue !== undefined && (typeof body.continue !== "boolean" || (body.continue && body.action !== "job.open"))) p.add("continue", "invalid", "continue is a boolean, for jobs only");
  if (body.startAt !== undefined && (typeof body.startAt !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(body.startAt) || !Number.isFinite(Date.parse(body.startAt)))) p.add("startAt", "invalid", "startAt must be an ISO 8601 date-time with offset");
  const c = parseCadence(body.cadence);
  if ("error" in c) p.add("cadence", "invalid", c.error);
  else {
    // floors: 10 min between questions, 30 between jobs; SCHEDULE_MIN_INTERVAL_SECONDS overrides both outside production (tests/e2e)
    const floorMs = o.floorSeconds != null ? o.floorSeconds * 1000 : (body.action === "oracle.request" ? LIMITS.schedule.minOracleIntervalMinutes : LIMITS.schedule.minJobIntervalMinutes) * 60_000;
    if (c.minIntervalMs < floorMs) p.add("cadence", "too_frequent", `runs must be at least ${floorMs >= 60_000 ? `${floorMs / 60_000} minutes` : `${floorMs / 1000} seconds`} apart for ${body.action === "oracle.request" ? "questions" : "jobs"}`);
  }
  if (!isObj(body.input)) p.add("input", "required", "input (the frozen action body) is required");
  else if (body.action === "job.open") {
    for (const k of ["parentJobId", "projectId"]) if (body.input[k] !== undefined) p.add(`input.${k}`, "not_allowed", `${k} is refused in a schedule`);
    p.list.push(...validateJobBody(body.input, { ...o, action: "schedule" }, "input").filter((x) => x.path !== "input.parentJobId"));
  } else if (body.action === "oracle.request") {
    p.list.push(...validateOracleBody(body.input, o).map((x) => ({ ...x, path: `input.${x.path}` })));
  }
  return p.list;
}

export function validateTopup(body: unknown): Problem[] {
  const p = new Problems();
  if (!isObj(body)) return [{ path: "input", code: "invalid", message: "top-up body must be an object" }];
  unknownKeys(p, body, ["scheduleId", "runs"], "");
  if (typeof body.scheduleId !== "string" || !UUID_RE.test(body.scheduleId)) p.add("scheduleId", "required", "scheduleId (UUID) is required");
  if (!Number.isInteger(body.runs) || body.runs < 1 || body.runs > 1_000_000) p.add("runs", "invalid", "runs 1–1,000,000");
  return p.list;
}
