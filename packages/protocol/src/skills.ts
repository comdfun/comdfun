/**
 * Built-in skill catalog (ids, roles, tiers and requirements as on IMD's live catalog). The authoritative
 * catalog is `skills/index.json` (generated from each SKILL.md by the services builder); the API merges this
 * table under it so the control plane can plan even before the skills folder exists.
 */
export type SkillRole = "implement" | "review" | "tests" | "integrate" | "reference";
export type Inference = "economy" | "standard" | "premium";
export type Requirement = "network" | "tool:image" | "tool:audio" | "tool:video";

export interface SkillInfo {
  id: string;
  role: SkillRole;
  /** null for reference skills */
  inference: Inference | null;
  /** 1 = the Clerk re-runs the suite, 2 = the Clerk checks paths/outputs; null for references */
  tier: 1 | 2 | null;
  requires: Requirement[];
  /** any: writes anywhere in scope; paths: the step must declare `paths`; none: artifacts/ only or nothing */
  writes: "any" | "paths" | "none";
  description: string;
}

const R = (id: string, description: string): SkillInfo => ({ id, role: "reference", inference: null, tier: null, requires: [], writes: "none", description });
const S = (id: string, role: SkillRole, inference: Inference, tier: 1 | 2, requires: Requirement[], writes: SkillInfo["writes"], description: string): SkillInfo =>
  ({ id, role, inference, tier, requires, writes, description });

export const BUILTIN_SKILLS: SkillInfo[] = [
  S("adapt-contract-project", "implement", "standard", 1, [], "any", "Make an existing Foundry project launchable through the launch factory with the smallest change."),
  S("adversarial-review", "review", "standard", 1, [], "none", "Cross-examine the implementation and its tests for defects another reader can reproduce; write nothing."),
  S("audit-imported-code", "review", "standard", 1, [], "none", "Audit a requester's contracts as received, before adaptation; write nothing."),
  S("audit-judge", "review", "standard", 1, [], "none", "Chief justice: merge the bench's findings, drop the unreproducible, rank worst-first."),
  S("audit-specialist", "review", "standard", 1, [], "none", "Justice of the bench: audit one concern of a launch in depth and report reproducible findings."),
  R("better-interface", "Reference: interface writing habits that keep front ends honest."),
  S("build-contract-project", "implement", "standard", 1, [], "any", "Build a complete Foundry project: contracts, tests, deploy script and launch.json."),
  S("build-ponder-indexer", "implement", "standard", 2, ["network"], "paths", "Build a Ponder indexer for deployed contracts."),
  S("build-website", "implement", "premium", 2, ["network"], "any", "Build a static website with a reproducible export."),
  S("create-audio", "implement", "standard", 2, ["tool:audio"], "none", "Produce an audio file under artifacts/."),
  S("create-image", "implement", "standard", 2, ["tool:image"], "none", "Produce an image under artifacts/."),
  S("create-video", "implement", "standard", 2, ["tool:video"], "none", "Produce a video under artifacts/."),
  R("custom-token-launch", "Reference: custom token launch terms and factory interface."),
  R("defi-native", "Reference: DeFi primitives and their failure modes."),
  S("deploy-script", "implement", "standard", 1, [], "paths", "Write a Foundry deploy script the Registrar can run."),
  R("eth-addresses", "Reference: canonical addresses on supported chains."),
  R("eth-concepts", "Reference: EVM concepts."),
  R("eth-frontend-ux", "Reference: wallet and transaction UX."),
  R("eth-l2s", "Reference: rollups and their settlement."),
  R("eth-robinhood-chain", "Reference: Robinhood Chain (4663 / testnet 46630) facts, RPCs, WETH, Permit2, COMD."),
  R("eth-security", "Reference: common Solidity vulnerabilities."),
  R("eth-standards", "Reference: ERC standards."),
  R("eth-testing", "Reference: Foundry testing practice."),
  R("evm-contracts-launch", "Reference: contracts-only launch terms."),
  R("evm-project-launch", "Reference: project launch terms and launch.json."),
  S("fix-findings", "implement", "standard", 1, [], "any", "Address the findings of a cross-examination without widening scope."),
  S("frontend-for-contract", "implement", "premium", 2, ["network"], "any", "Build the front end for a deployed contract project."),
  S("gas-and-size-report", "tests", "standard", 1, [], "none", "Report gas and bytecode sizes."),
  S("implement-and-test", "implement", "standard", 1, [], "any", "Implement a contract and its tests."),
  S("implement-component", "implement", "standard", 2, ["network"], "paths", "Implement one front-end component inside declared paths."),
  S("implement-contract", "implement", "standard", 1, [], "any", "Implement a contract."),
  S("implement-one-contract", "implement", "standard", 1, [], "paths", "Implement exactly one contract at a declared path."),
  S("import-site", "implement", "standard", 2, ["network"], "any", "Import an existing site repository and make it build."),
  S("integrate-project", "integrate", "standard", 2, ["network"], "any", "Join parallel work into one building project."),
  S("oracle-assess", "implement", "economy", 2, ["network"], "none", "Answer one typed oracle question with a reproducible recipe."),
  R("pashov-fizz", "Reference: fuzzing heuristics."),
  R("pashov-skill", "Reference: audit checklist."),
  R("pashov-xray", "Reference: codebase x-ray method."),
  R("public-rpcs", "Reference: public RPC endpoints."),
  S("refine-project", "implement", "standard", 2, [], "paths", "Refine an existing project within declared paths."),
  S("research-report", "implement", "standard", 2, ["network"], "none", "Research a question into a cited report under artifacts/."),
  S("scaffold-project", "implement", "standard", 2, ["network"], "any", "Scaffold a project skeleton."),
  S("site-content-check", "review", "standard", 1, [], "none", "Check a built site's content and links; write nothing."),
  R("solidity-security-review", "Reference: security review method."),
  R("tob-entry-point-analyzer", "Reference: entry point analysis."),
  R("tob-property-based-testing", "Reference: property-based testing."),
  R("uniswap-v4-hooks", "Reference: Uniswap v4 hooks."),
  R("uniswap-v4-security", "Reference: Uniswap v4 hook security."),
  S("workflow-planner", "implement", "standard", 2, [], "none", "Plan the front-end half of a workflow from the deployed contracts."),
  S("write-foundry-tests", "tests", "standard", 1, [], "paths", "Write Foundry tests (unit, fuzz, invariant)."),
  S("write-readme-and-docs", "implement", "standard", 2, [], "paths", "Write README and docs."),
];

export const BUILTIN_SKILL_MAP: Record<string, SkillInfo> = Object.fromEntries(BUILTIN_SKILLS.map((s) => [s.id, s]));

export function isRunnable(s: SkillInfo | undefined): boolean {
  return !!s && s.role !== "reference";
}

/** Premium work (contracts' front ends, websites) routes only to seats on premium runtimes. */
export function isPremium(s: SkillInfo | undefined): boolean {
  return s?.inference === "premium";
}

/** Checks that mark a skill as contract work (Foundry builds). */
const CONTRACT_CHECKS = ["foundry-build", "foundry-test", "foundry-sizes", "foundry-script"];

/**
 * Premium routing rule (IMD's worker README): contract work and front-end work need a top-tier model at high
 * effort. A node is premium when its skill's inference tier is "premium" (websites, contract front ends) or when
 * it writes contracts: an implement/tests/integrate skill whose checks build with Foundry. Reviews are not premium
 * (any independent seat may cross-examine).
 */
export function requiresPremium(s: { inference?: string | null; role?: string | null; checks?: readonly string[] | null } | undefined): boolean {
  if (!s) return false;
  if (s.inference === "premium") return true;
  const writes = s.role === "implement" || s.role === "tests" || s.role === "integrate";
  return writes && (s.checks ?? []).some((c) => CONTRACT_CHECKS.includes(c));
}

/** Model ids the network treats as premium (override with PREMIUM_MODELS, a regex). */
export const DEFAULT_PREMIUM_MODEL_RE = /opus|fable|gpt-5(\.\d+)?(-codex)?(-max)?$|gpt-6|o3-pro/i;

/** Reasoning effort levels that count as "high" (Claude Code effort / Codex model_reasoning_effort). */
export const PREMIUM_EFFORTS = ["high", "xhigh", "max"] as const;

/** A runtime is premium when its model is top-tier AND it runs at high effort. */
export function isPremiumRuntime(rt: { model: string | null; effort: string | null }, modelRe: RegExp = DEFAULT_PREMIUM_MODEL_RE): boolean {
  return !!rt.model && modelRe.test(rt.model) && !!rt.effort && (PREMIUM_EFFORTS as readonly string[]).includes(rt.effort.toLowerCase());
}
