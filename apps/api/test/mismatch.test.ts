/**
 * "How many slots are in one Ethereum proof-of-stake epoch? Answer with the whole number only." was filed as a
 * research-report. That skill is checked by research-citations, which wants a cited report of some length, so the
 * Counsel answered "32" — correctly — and the verifier rejected it three times until the matter failed. The payer had
 * already been charged. A matter that cannot pass its own verifier is refused at the check, where nothing is charged.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { validateJobBody } from "../src/validate.ts";
import { SkillCatalog } from "../src/skills.ts";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../skills");

const opts = () => ({
  action: "job.open" as const,
  skills: new SkillCatalog(SKILLS_DIR),
  launchChains: [4663],
  launchKindsFor: () => ["custom_token"],
  pairingsFor: () => ["WETH"],
});

const problems = (objective: string, skill = "research-report") =>
  validateJobBody({ objective, skill, github: false }, opts());

test("the matter that failed on the docket is refused at the check instead", () => {
  const ps = problems("How many slots are in one Ethereum proof-of-stake epoch? Answer with the whole number only.");
  const m = ps.find((x) => x.code === "skill_mismatch");
  assert.ok(m, `expected a skill_mismatch blocker, got ${JSON.stringify(ps)}`);
  assert.match(m!.message, /Oracle/, "it should point at the thing that does answer short questions");
});

test("the other ways people ask for a bare answer", () => {
  for (const o of [
    "What is the block time? Number only.",
    "Give me just the number of validators.",
    "Who is the deployer? One word.",
    "What is the supply, no explanation please.",
    "Answer only: how many chambers are there?",
  ]) assert.ok(problems(o).some((x) => x.code === "skill_mismatch"), o);
});

test("an ordinary research question still passes", () => {
  for (const o of [
    "Write a report on Ethereum's proof-of-stake epoch structure and its tradeoffs.",
    "Research the history of Permit2 adoption, with sources.",
    "Compare three L2 fee models and cite your numbers.",
  ]) assert.ok(!problems(o).some((x) => x.code === "skill_mismatch"), o);
});

test("the rule is tied to the verifier, not to the wording", () => {
  // the same objective against a skill that is not checked for citations is fine
  assert.ok(!problems("What is the block time? Number only.", "create-image").some((x) => x.code === "skill_mismatch"));
});
