/**
 * The Managing Partner: turns an admitted body into a job graph. Deterministic everywhere except the
 * front-end half of a workflow, which IMD plans with its `workflow-planner` skill (see workflows.ts).
 *
 *   skill                     → one node
 *   template                  → single | impl_tests | impl_tests_review | multi_contract | fuzz | research | audit
 *   steps + shape             → chain (each after the previous) | fan_out_join (all but last in parallel, last joins) | dag
 *   launch.open               → the final adversarial-review is replaced by the Bench: 4 audit-specialist + audit-judge
 *   oracle.request            → panelSize × oracle-assess (one member per seat)
 */
import { requiresPremium, type JobBody, type JobNode, type StepBody, type OracleBody } from "@company/protocol";
import type { SkillCatalog } from "./skills.ts";

export const AUDIT_CONCERNS = [
  "access control, ownership and privileged roles",
  "arithmetic, accounting, rounding and share math",
  "external calls, reentrancy, token behaviour and oracles",
  "launch terms: supply, pool seeding, allocations, deployment script",
];

export interface Plan { template: string; shape: string; nodes: JobNode[]; notes: string[] }

export function node(skills: SkillCatalog, key: string, skill: string, kind: JobNode["kind"], opts: Partial<JobNode> & { paths?: string[] } = {}): JobNode {
  const meta = skills.get(skill);
  // the skill's own required outputs (skills/index.json) join the step's named outputs
  const outputs = [...(opts.outputs ?? [])];
  for (const o of meta?.outputs ?? []) {
    if ((o as any).required === false || outputs.some((x) => x.path === o.path)) continue;
    outputs.push({ name: o.name ?? o.path.split("/").pop()!.replace(/\.[^.]+$/, ""), path: o.path, mediaType: o.mediaType });
  }
  let allowed: string[];
  if (kind === "review" || kind === "audit" || kind === "judge") allowed = ["artifacts"];
  else if (opts.paths && opts.paths.length) allowed = [...opts.paths];
  else if (meta?.writes === "none") allowed = ["artifacts"];
  else allowed = ["**"];
  for (const o of outputs) if (!allowed.includes(o.path) && !allowed.includes("**")) allowed.push(o.path);
  return {
    key,
    skill,
    role: meta?.role ?? "implement",
    kind,
    state: "pending",
    attempt: 1,
    revisions: 0,
    judgeRevisions: 0,
    dependsOn: opts.dependsOn ?? [],
    allowedPaths: allowed,
    objective: opts.objective ?? null,
    acceptanceCriteria: opts.acceptanceCriteria ?? [],
    references: opts.references ?? [],
    inputs: opts.inputs ?? [],
    outputs,
    variables: opts.variables ?? {},
    // premium = contract work (Foundry implement/tests/integrate) or front-end work (inference "premium"):
    // routed only to seats on a top-tier model at high effort
    premium: requiresPremium(meta ? { inference: meta.inference, role: meta.role, checks: meta.checks } : undefined),
    reviews: opts.reviews ?? [],
    failureReason: null,
    dispatchNote: null,
    dispatchNoteAt: null,
    updatedAt: new Date(0).toISOString(),
    verdict: null,
    seat: null,
    submissionHash: null,
    excluded: [],
  };
}

const kindOf = (skills: SkillCatalog, skill: string): JobNode["kind"] =>
  skill === "audit-specialist" ? "audit" : skill === "audit-judge" ? "judge" : skills.get(skill)?.role === "review" ? "review" : "work";

const keyFor = (skill: string, used: Set<string>) => {
  let base = skill.replace(/-/g, "_").slice(0, 28);
  if (!/^[a-z]/.test(base)) base = `s_${base}`;
  let k = base;
  for (let i = 2; used.has(k); i++) k = `${base}_${i}`;
  used.add(k);
  return k;
};

function fromSteps(skills: SkillCatalog, body: JobBody): JobNode[] {
  const steps = body.steps as StepBody[];
  const used = new Set<string>(steps.filter((s) => s.key).map((s) => s.key!));
  const keys = steps.map((s) => s.key ?? keyFor(s.skill, used));
  return steps.map((s, i) => {
    let deps: string[];
    if (body.shape === "dag") deps = s.dependsOn ?? [];
    else if (body.shape === "fan_out_join") deps = i === steps.length - 1 && steps.length > 1 ? keys.slice(0, -1) : [];
    else deps = i === 0 ? [] : [keys[i - 1]];
    return node(skills, keys[i], s.skill, kindOf(skills, s.skill), {
      dependsOn: deps,
      objective: s.objective ?? null,
      acceptanceCriteria: s.acceptanceCriteria ?? [],
      references: [...(body.references ?? []), ...(s.references ?? [])],
      inputs: [...(i === 0 ? body.inputs ?? [] : []), ...(s.inputs ?? [])],
      outputs: s.outputs ?? (i === steps.length - 1 ? body.outputs ?? [] : []),
      variables: s.variables ?? {},
      paths: s.paths ?? body.paths,
    });
  });
}

function fromTemplate(skills: SkillCatalog, body: JobBody): JobNode[] {
  const refs = body.references ?? [];
  const contracts = body.contracts ?? [];
  const common = { references: refs, inputs: body.inputs ?? [] };
  switch (body.template) {
    case "single":
      return [node(skills, "implement", "implement-and-test", "work", { ...common, outputs: body.outputs ?? [], paths: body.paths })];
    case "impl_tests":
    case "impl_tests_review": {
      const n = [
        node(skills, "implement", "implement-contract", "work", { ...common, paths: body.paths, variables: { contracts: contracts.join(",") } }),
        node(skills, "tests", "write-foundry-tests", "work", { references: refs, dependsOn: ["implement"], paths: ["test"] }),
      ];
      if (body.template === "impl_tests_review") n.push(node(skills, "review", "adversarial-review", "review", { references: refs, dependsOn: ["tests"] }));
      return n;
    }
    case "multi_contract": {
      const impl = contracts.map((c, i) => node(skills, `impl_${i + 1}`, "implement-one-contract", "work", { ...common, paths: [c], variables: { contract: c } }));
      const keys = impl.map((x) => x.key);
      return [
        ...impl,
        node(skills, "tests", "write-foundry-tests", "work", { references: refs, dependsOn: keys, paths: ["test"] }),
        node(skills, "review", "adversarial-review", "review", { references: refs, dependsOn: ["tests"] }),
      ];
    }
    case "fuzz": {
      const harness = contracts[0] ?? "test";
      const dir = harness.includes("/") ? harness.slice(0, harness.lastIndexOf("/")) : "test";
      return [node(skills, "fuzz", "write-foundry-tests", "work", {
        ...common,
        paths: [dir],
        variables: { mode: "fuzz", runs: String(body.runs ?? 10_000), harness, projectPath: String(body.projectPath ?? "."), rubric: JSON.stringify(body.rubric ?? null) },
      })];
    }
    case "research": {
      const size = body.panelSize ?? 1;
      const out = body.outputs?.length ? body.outputs : [{ name: "report", path: "artifacts/report.md", mediaType: "text/markdown" }];
      return Array.from({ length: size }, (_, i) =>
        node(skills, size === 1 ? "research_report" : `panel_${i + 1}`, "research-report", size === 1 ? "work" : "panel", {
          ...common,
          outputs: out,
          variables: { minCitations: String(body.minCitations ?? 0), rubric: JSON.stringify(body.rubric ?? null) },
        }));
    }
    case "audit":
      return bench(skills, [], refs, "audit");
    default:
      throw new Error(`unknown template ${body.template}`);
  }
}

/** The Bench: 4 audit-specialist (one concern each) + audit-judge. */
export function bench(skills: SkillCatalog, deps: string[], refs: string[], prefix = "audit"): JobNode[] {
  const specialists = AUDIT_CONCERNS.map((concern, i) =>
    node(skills, `${prefix}_${i + 1}`, "audit-specialist", "audit", { dependsOn: deps, references: refs, objective: `Concern: ${concern}.`, variables: { concern } }));
  const judge = node(skills, `${prefix}_judge`, "audit-judge", "judge", { dependsOn: specialists.map((s) => s.key), references: refs, objective: "Merge the bench's findings worst-first; drop anything not reproduced." });
  return [...specialists, judge];
}

/** Non-review ancestors of a node: what a review examines. */
export function workAncestors(nodes: JobNode[], key: string): string[] {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const out = new Set<string>();
  const stack = [...(byKey.get(key)?.dependsOn ?? [])];
  while (stack.length) {
    const k = stack.pop()!;
    const n = byKey.get(k);
    if (!n) continue;
    if (n.kind === "work") out.add(k);
    stack.push(...n.dependsOn);
  }
  return [...out].sort();
}

export function planJob(body: JobBody, o: { skills: SkillCatalog; launch: boolean; parentSkill?: string | null }): Plan {
  const notes: string[] = [];
  let nodes: JobNode[];
  let template: string;
  let shape: string;
  if (body.steps?.length) {
    nodes = fromSteps(o.skills, body);
    template = `custom:${body.shape}`;
    shape = body.shape!;
  } else if (body.template) {
    nodes = fromTemplate(o.skills, body);
    template = body.template;
    shape = body.template === "research" || body.template === "multi_contract" ? "fan_out_join" : "chain";
  } else {
    const skill = body.skill ?? o.parentSkill ?? "implement-and-test";
    if (!body.skill) notes.push(`no skill given; rerunning the parent's ${skill}`);
    nodes = [node(o.skills, skill.replace(/-/g, "_"), skill, kindOf(o.skills, skill), {
      references: body.references ?? [], inputs: body.inputs ?? [], outputs: body.outputs ?? [], paths: body.paths,
      variables: skill === "research-report" ? { minCitations: String(body.minCitations ?? 0) } : {},
    })];
    template = `skill:${skill}`;
    shape = "chain";
  }

  if (o.launch) {
    const sinks = nodes.filter((n) => !nodes.some((m) => m.dependsOn.includes(n.key)));
    const finalReview = sinks.length === 1 && sinks[0].skill === "adversarial-review" ? sinks[0] : null;
    if (finalReview) {
      nodes = nodes.filter((n) => n !== finalReview);
      nodes.push(...bench(o.skills, finalReview.dependsOn, finalReview.references));
      notes.push("launch: the final adversarial-review is replaced by the Bench (4 audit-specialist + audit-judge)");
    } else {
      nodes.push(...bench(o.skills, sinks.map((s) => s.key), body.references ?? []));
      notes.push("launch: the Bench (4 audit-specialist + audit-judge) is added before deployment");
    }
  }
  for (const n of nodes) if (n.kind !== "work" && n.kind !== "panel") n.reviews = workAncestors(nodes, n.key);
  return { template, shape, nodes, notes };
}

export function planOracle(body: OracleBody, skills: SkillCatalog): Plan {
  const nodes = Array.from({ length: body.panelSize }, (_, i) =>
    node(skills, `member_${i + 1}`, "oracle-assess", "panel", { outputs: [], variables: { answerType: body.answerType } }));
  return { template: "oracle", shape: "fan_out_join", nodes, notes: [`panel of ${body.panelSize}, quorum ${body.quorum} (all quorum members must match)`] };
}

/** Human-readable plan lines for POST /requests/check. */
export function describePlan(p: Plan): string[] {
  return p.nodes.map((n) => {
    const deps = n.dependsOn.length ? ` after ${n.dependsOn.join(", ")}` : "";
    const what = n.objective ? ` — ${n.objective.slice(0, 120)}` : "";
    return `${n.key}: ${n.skill}${deps}${what}`;
  });
}
