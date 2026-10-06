import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CHECK_IDS, loadSkillCatalog, readSkillMarkdown, sha256Hex } from "../src/index.ts";
import { REPO_ROOT } from "./helpers/util.ts";

const skillsDir = path.join(REPO_ROOT, "skills");

describe("skill catalog", () => {
  test("51 skills: 29 runnable, 22 reference; hashes match SKILL.md bytes", async () => {
    const cat = await loadSkillCatalog(skillsDir);
    const all = Object.values(cat.skills);
    assert.equal(cat.count, 51);
    assert.equal(all.length, 51);
    assert.equal(all.filter((s) => s.kind === "runnable").length, 29);
    assert.equal(all.filter((s) => s.kind === "reference").length, 22);
    for (const s of all) {
      const md = await readSkillMarkdown(s.id, skillsDir);
      assert.equal(sha256Hex(md), s.sha256, `${s.id} hash`);
      for (const c of s.checks) assert.ok((CHECK_IDS as readonly string[]).includes(c), `${s.id}: unknown check ${c}`);
    }
    assert.equal(cat.skills["build-website"].inference, "premium");
    assert.deepEqual(cat.skills["create-video"].requires, ["tool:video"]);
    assert.equal(cat.skills["oracle-assess"].inference, "economy");
    assert.equal(cat.skills["eth-robinhood-chain"].origin, "comd");
  });

  test("check-skill.mjs passes on the whole catalog and agrees on check ids", () => {
    const out = execFileSync(process.execPath, [path.join(skillsDir, "check-skill.mjs"), "--json"], { encoding: "utf8" });
    const report = JSON.parse(out);
    assert.equal(report.ok, true, JSON.stringify(report.results.filter((r: any) => r.errors.length)));
    assert.equal(report.checked, 51);
    const src = readFileSync(path.join(skillsDir, "check-skill.mjs"), "utf8");
    const m = /export const CHECK_IDS = \[([\s\S]*?)\];/.exec(src)!;
    const ids = [...m[1].matchAll(/"([a-z-]+)"/g)].map((x) => x[1]);
    assert.deepEqual(ids, [...CHECK_IDS]);
  });

  test("rejects path-like skill ids", async () => {
    await assert.rejects(readSkillMarkdown("../package", skillsDir), /invalid skill id/);
  });
});
