import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { appendFile, cp, writeFile } from "node:fs/promises";
import path from "node:path";
import { verifySubmission, validateWorkflowPlan, extractCitations, type SkillMeta } from "../src/index.ts";
import { FORGE_BIN, HAVE_FOUNDRY, cleanupAll, foundryFixture, makeMp4, makePng, makeWav, tempDir, writeTree } from "./helpers/util.ts";

after(cleanupAll);

function skill(p: Partial<SkillMeta> & { id: string; checks: SkillMeta["checks"] }): SkillMeta {
  return {
    version: 1,
    kind: "runnable",
    role: "implement",
    inference: "standard",
    tier: 2,
    judge: "verifier-paths",
    requires: [],
    writes: "paths",
    outputs: [],
    description: "test skill",
    ...p,
  };
}

async function baseAndWorkspace(base: Record<string, string | Uint8Array>, changes: Record<string, string | Uint8Array>) {
  const root = await tempDir();
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.join(root, "base"), { recursive: true });
  const baseDir = await writeTree(path.join(root, "base"), base);
  const ws = path.join(root, "ws");
  await cp(baseDir, ws, { recursive: true });
  await writeTree(ws, changes);
  return { baseDir, ws };
}

const status = (r: Awaited<ReturnType<typeof verifySubmission>>, id: string) => r.checks.find((c) => c.id === id)?.status;

describe("Clerk: write budget", () => {
  test("changes inside allowed paths pass", async () => {
    const { baseDir, ws } = await baseAndWorkspace({ "src/A.sol": "a", "README.md": "r" }, { "src/A.sol": "a2", "src/B.sol": "b" });
    const r = await verifySubmission({ workspaceDir: ws, baseDir, allowedPaths: ["src/"], skill: skill({ id: "implement-contract", checks: ["paths"] }) });
    assert.equal(r.ok, true, JSON.stringify(r.checks));
    assert.deepEqual(r.changed, { added: ["src/B.sol"], modified: ["src/A.sol"], deleted: [] });
  });

  test("a change outside allowed paths fails with a finding per path", async () => {
    const { baseDir, ws } = await baseAndWorkspace({ "src/A.sol": "a", "README.md": "r" }, { "src/A.sol": "a2", "README.md": "hijacked", "foundry.toml": "x" });
    const r = await verifySubmission({ workspaceDir: ws, baseDir, allowedPaths: ["src/**/*.sol"], skill: skill({ id: "implement-contract", checks: ["paths"] }) });
    assert.equal(r.ok, false);
    assert.equal(status(r, "paths"), "fail");
    assert.deepEqual(r.findings.filter((f) => f.path).map((f) => f.path).sort(), ["README.md", "foundry.toml"]);
  });

  test("deletions count as changes", async () => {
    const { baseDir, ws } = await baseAndWorkspace({ "src/A.sol": "a", "test/A.t.sol": "t" }, {});
    const { rm } = await import("node:fs/promises");
    await rm(path.join(ws, "test/A.t.sol"));
    const r = await verifySubmission({ workspaceDir: ws, baseDir, allowedPaths: ["src/"], skill: skill({ id: "implement-contract", checks: ["paths"] }) });
    assert.equal(r.ok, false);
    assert.deepEqual(r.changed.deleted, ["test/A.t.sol"]);
  });

  test("skills that need declared paths refuse an empty budget", async () => {
    const { baseDir, ws } = await baseAndWorkspace({ "a.txt": "a" }, { "a.txt": "b" });
    const r = await verifySubmission({ workspaceDir: ws, baseDir, skill: skill({ id: "refine-project", checks: ["paths"], writes: "paths" }) });
    assert.equal(status(r, "paths"), "fail");
  });

  test("review skills may only write artifacts/", async () => {
    const { baseDir, ws } = await baseAndWorkspace({ "src/A.sol": "a" }, { "src/A.sol": "patched by reviewer" });
    const r = await verifySubmission({ workspaceDir: ws, baseDir, skill: skill({ id: "adversarial-review", role: "review", writes: "none", checks: ["no-writes"] }) });
    assert.equal(status(r, "no-writes"), "fail");
  });

  test("symlinks are refused", async () => {
    const { baseDir, ws } = await baseAndWorkspace({ "a.txt": "a" }, {});
    const { symlink } = await import("node:fs/promises");
    await symlink("/etc/passwd", path.join(ws, "leak"));
    const r = await verifySubmission({ workspaceDir: ws, baseDir, allowedPaths: ["**"], skill: skill({ id: "scaffold-project", checks: ["paths"], writes: "any" }) });
    assert.equal(status(r, "symlinks"), "fail");
    assert.equal(r.ok, false);
  });
});

describe("Clerk: declared outputs", () => {
  test("missing output fails; present output with matching bytes passes", async () => {
    const { baseDir, ws } = await baseAndWorkspace({ "a.txt": "a" }, { "artifacts/summary.json": '{"ok":true}' });
    const outputs = [
      { name: "summary", path: "artifacts/summary.json", mediaType: "application/json" },
      { name: "chart", path: "artifacts/chart.png", mediaType: "image/png" },
    ];
    const r = await verifySubmission({ workspaceDir: ws, baseDir, outputs, skill: skill({ id: "implement-component", checks: ["outputs"], writes: "any" }) });
    assert.equal(status(r, "outputs"), "fail");
    assert.ok(r.findings.some((f) => f.message.includes("declared output missing: artifacts/chart.png")));
    await writeFile(path.join(ws, "artifacts/chart.png"), makePng());
    const r2 = await verifySubmission({ workspaceDir: ws, baseDir, outputs, skill: skill({ id: "implement-component", checks: ["outputs"], writes: "any" }) });
    assert.equal(r2.ok, true, JSON.stringify(r2.findings));
  });

  test("a text file renamed .png is caught by magic bytes", async () => {
    const { baseDir, ws } = await baseAndWorkspace({}, { "artifacts/cover.png": "this is not a png at all, just text pretending" });
    const r = await verifySubmission({
      workspaceDir: ws,
      baseDir,
      outputs: [{ name: "cover", path: "artifacts/cover.png", mediaType: "image/png" }],
      skill: skill({ id: "create-image", requires: ["tool:image"], writes: "none", checks: ["no-writes", "outputs", "media-image"] }),
    });
    assert.equal(r.ok, false);
    assert.equal(status(r, "outputs"), "fail");
    assert.equal(status(r, "media-image"), "fail");
  });

  test("outputs must live under artifacts/", async () => {
    const { baseDir, ws } = await baseAndWorkspace({}, { "out.json": "{}" });
    const r = await verifySubmission({ workspaceDir: ws, baseDir, outputs: [{ path: "out.json", mediaType: "application/json" }], skill: skill({ id: "scaffold-project", writes: "any", checks: ["outputs"] }) });
    assert.equal(status(r, "outputs"), "fail");
  });
});

describe("Clerk: media magic bytes", () => {
  test("image, audio and video families", async () => {
    for (const [family, file, bytes, mediaType] of [
      ["image", "artifacts/a.png", makePng(), "image/png"],
      ["audio", "artifacts/a.wav", makeWav(), "audio/wav"],
      ["video", "artifacts/a.mp4", makeMp4(), "video/mp4"],
    ] as const) {
      const { baseDir, ws } = await baseAndWorkspace({}, { [file]: bytes });
      const s = skill({ id: `create-${family}`, writes: "none", requires: [`tool:${family}`], checks: ["no-writes", "outputs", `media-${family}`] });
      const r = await verifySubmission({ workspaceDir: ws, baseDir, outputs: [{ path: file, mediaType }], skill: s });
      assert.equal(r.ok, true, `${family}: ${JSON.stringify(r.checks)}`);
      // wrong family: a WAV declared as video
      if (family === "video") {
        const { baseDir: b2, ws: w2 } = await baseAndWorkspace({}, { "artifacts/a.mp4": makeWav() });
        const bad = await verifySubmission({ workspaceDir: w2, baseDir: b2, outputs: [{ path: "artifacts/a.mp4", mediaType: "video/mp4" }], skill: s });
        assert.equal(bad.ok, false);
      }
    }
  });
});

describe("Clerk: research reports", () => {
  const research = skill({ id: "research-report", requires: ["network"], writes: "none", checks: ["no-writes", "outputs", "research-citations"], outputs: [{ path: "artifacts/report.md", mediaType: "text/markdown", required: true }] });
  const body = (links: string[]) =>
    `# Robinhood Chain sequencer\n\n${"Analysis paragraph with substance. ".repeat(15)}\n\n## Findings\n\n${links.map((l, i) => `- Claim ${i} [source](${l})`).join("\n")}\n\n## Uncertainty\n\nSome claims are unverified.\n`;

  test("enough distinct citations pass", async () => {
    const { baseDir, ws } = await baseAndWorkspace({}, { "artifacts/report.md": body(["https://docs.robinhood.com/chain", "https://docs.arbitrum.io/", "https://l2beat.com/scaling/projects"]) });
    const r = await verifySubmission({ workspaceDir: ws, baseDir, minCitations: 3, rubricContains: ["sequencer"], skill: research });
    assert.equal(r.ok, true, JSON.stringify(r.checks));
  });

  test("too few citations (duplicates do not count) fail", async () => {
    const { baseDir, ws } = await baseAndWorkspace({}, { "artifacts/report.md": body(["https://a.example/x", "https://a.example/x#frag", "https://b.example/"]) });
    const r = await verifySubmission({ workspaceDir: ws, baseDir, minCitations: 3, skill: research });
    assert.equal(status(r, "research-citations"), "fail");
  });

  test("missing rubric phrase fails", async () => {
    const { baseDir, ws } = await baseAndWorkspace({}, { "artifacts/report.md": body(["https://a.example/", "https://b.example/"]) });
    const r = await verifySubmission({ workspaceDir: ws, baseDir, minCitations: 1, rubricContains: ["gas token is ETH"], skill: research });
    assert.equal(r.ok, false);
  });

  test("citation extraction", () => {
    assert.deepEqual(extractCitations("see [x](https://a.example/p). and <https://b.example/q> or https://c.example/r, end").sort(), [
      "https://a.example/p",
      "https://b.example/q",
      "https://c.example/r",
    ]);
  });
});

describe("Clerk: JSON reports", () => {
  test("review report schema and verdict consistency", async () => {
    const good = {
      verdict: "reject",
      findings: [{ id: "F1", severity: "high", title: "Owner can be bypassed", location: "src/A.sol:12", blocking: true, evidence: "call setNumber from a non-owner after constructor; see test sketch" }],
    };
    const s = skill({ id: "adversarial-review", role: "review", writes: "none", checks: ["no-writes", "review-report"] });
    const { baseDir, ws } = await baseAndWorkspace({ "src/A.sol": "contract A {}" }, { "artifacts/review.json": JSON.stringify(good) });
    assert.equal((await verifySubmission({ workspaceDir: ws, baseDir, skill: s })).ok, true);
    await writeFile(path.join(ws, "artifacts/review.json"), JSON.stringify({ verdict: "accept", findings: good.findings }));
    const bad = await verifySubmission({ workspaceDir: ws, baseDir, skill: s });
    assert.equal(status(bad, "review-report"), "fail");
  });

  test("workflow plan validation", () => {
    const runnable = new Set(["build-contract-project", "write-foundry-tests", "adversarial-review", "frontend-for-contract"]);
    assert.deepEqual(
      validateWorkflowPlan(
        {
          shape: "dag",
          steps: [
            { key: "build", skill: "build-contract-project", dependsOn: [] },
            { key: "tests", skill: "write-foundry-tests", dependsOn: ["build"] },
            { key: "review", skill: "adversarial-review", dependsOn: ["tests"] },
          ],
        },
        runnable,
      ),
      [],
    );
    const errs = validateWorkflowPlan({ shape: "dag", steps: [{ key: "a", skill: "eth-security", dependsOn: ["z"] }, { key: "b", skill: "adversarial-review", dependsOn: [] }] }, runnable);
    assert.ok(errs.some((e) => e.includes("not a runnable skill")));
    assert.ok(errs.some((e) => e.includes("not an earlier step")));
    assert.ok(validateWorkflowPlan({ shape: "chain", steps: new Array(7).fill({ skill: "adversarial-review" }) }, runnable).some((e) => e.includes("1-6")));
  });

  test("oracle answer schema", async () => {
    const s = skill({ id: "oracle-assess", inference: "economy", requires: ["network"], writes: "none", checks: ["no-writes", "oracle-answer"] });
    const answer = {
      answerType: "uint256",
      answer: "1000000",
      chainId: 46630,
      fromBlock: "100",
      toBlock: "200",
      recipe: { steps: [{ method: "eth_call", to: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", data: "0x18160ddd", block: "200" }] },
    };
    const { baseDir, ws } = await baseAndWorkspace({}, { "artifacts/answer.json": JSON.stringify(answer) });
    assert.equal((await verifySubmission({ workspaceDir: ws, baseDir, skill: s })).ok, true);
    await writeFile(path.join(ws, "artifacts/answer.json"), JSON.stringify({ ...answer, answer: 5 }));
    assert.equal((await verifySubmission({ workspaceDir: ws, baseDir, skill: s })).ok, false);
  });
});

describe("Clerk: web projects", () => {
  test("npm ci + build producing dist/index.html passes; a build without index fails", async () => {
    const files = {
      "package.json": JSON.stringify({ name: "site", version: "1.0.0", private: true, scripts: { build: "node build.mjs" } }),
      "package-lock.json": JSON.stringify({ name: "site", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "site", version: "1.0.0" } } }),
      "build.mjs": `import { mkdirSync, writeFileSync } from "node:fs"; mkdirSync("dist", { recursive: true }); writeFileSync("dist/index.html", "<!doctype html><title>Filed</title><p>On the record.</p>");`,
    };
    const s = skill({ id: "build-website", inference: "premium", requires: [], writes: "any", checks: ["paths", "web-build", "site-screen"] });
    const { baseDir, ws } = await baseAndWorkspace({}, files);
    const r = await verifySubmission({ workspaceDir: ws, baseDir, skill: s, timeoutMs: 120_000 });
    assert.equal(r.ok, true, JSON.stringify(r.checks, null, 1));
    await writeFile(path.join(ws, "build.mjs"), `console.log("forgot to emit");`);
    const r2 = await verifySubmission({ workspaceDir: ws, baseDir, skill: s, timeoutMs: 120_000 });
    assert.equal(status(r2, "web-build"), "fail");
  });

  test("a site that loads a drainer script is failed by the screen", async () => {
    const files = {
      "package.json": JSON.stringify({ name: "site", version: "1.0.0", private: true, scripts: { build: "node build.mjs" } }),
      "package-lock.json": JSON.stringify({ name: "site", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "site", version: "1.0.0" } } }),
      "build.mjs": `import { mkdirSync, writeFileSync } from "node:fs"; mkdirSync("dist", { recursive: true }); writeFileSync("dist/index.html", '<!doctype html><script src="https://evil-cdn.example/x.js"></script>');`,
    };
    const s = skill({ id: "build-website", writes: "any", checks: ["paths", "web-build", "site-screen"] });
    const { baseDir, ws } = await baseAndWorkspace({}, files);
    const r = await verifySubmission({ workspaceDir: ws, baseDir, skill: s, timeoutMs: 120_000 });
    assert.equal(status(r, "web-build"), "pass");
    assert.equal(status(r, "site-screen"), "fail");
  });
});

describe("Clerk: Foundry projects", { skip: !HAVE_FOUNDRY && "forge/solc not available" }, () => {
  const s = skill({ id: "build-contract-project", tier: 1, judge: "verifier-rerun", writes: "any", checks: ["paths", "foundry-build", "foundry-test", "foundry-sizes"] });

  test("a building, passing project passes", async () => {
    const ws = await foundryFixture();
    const r = await verifySubmission({ workspaceDir: ws, skill: s, forgeBin: FORGE_BIN, timeoutMs: 180_000 });
    assert.equal(r.ok, true, JSON.stringify(r.checks, null, 1));
    assert.match(r.checks.find((c) => c.id === "foundry-test")!.detail, /3 passed/);
  });

  test("a failing test fails foundry-test and names the test", async () => {
    const ws = await foundryFixture();
    await appendFile(
      path.join(ws, "test/Counter.t.sol"),
      `\ncontract BrokenTest {\n    function test_AlwaysFails() public pure {\n        require(false, "broken");\n    }\n}\n`,
    );
    const r = await verifySubmission({ workspaceDir: ws, skill: s, forgeBin: FORGE_BIN, timeoutMs: 180_000 });
    assert.equal(r.ok, false);
    assert.equal(status(r, "foundry-build"), "pass");
    assert.equal(status(r, "foundry-test"), "fail");
    assert.ok(r.findings.some((f) => f.message.includes("test_AlwaysFails")), JSON.stringify(r.findings));
  });

  test("a compile error fails foundry-build", async () => {
    const ws = await foundryFixture();
    await appendFile(path.join(ws, "src/Counter.sol"), "\ncontract Broken { function f() public { undefinedThing(); } }\n");
    const r = await verifySubmission({ workspaceDir: ws, skill: s, forgeBin: FORGE_BIN, timeoutMs: 180_000 });
    assert.equal(status(r, "foundry-build"), "fail");
    assert.equal(r.ok, false);
  });

  test("missing forge is an error, not a pass", async () => {
    const ws = await foundryFixture();
    const r = await verifySubmission({ workspaceDir: ws, skill: s, forgeBin: "/nonexistent/forge" });
    assert.equal(status(r, "foundry-build"), "error");
    assert.equal(r.ok, false);
  });

  test("launch manifest check", async () => {
    const ws = await foundryFixture();
    const m = skill({ id: "adapt-contract-project", writes: "any", checks: ["launch-manifest"] });
    assert.equal((await verifySubmission({ workspaceDir: ws, skill: m })).ok, true);
    await writeFile(path.join(ws, "launch.json"), JSON.stringify({ schema: "company.launch.v1", kind: "custom_token", chainId: 46630, script: "script/Launch.s.sol:Launch" }));
    const bad = await verifySubmission({ workspaceDir: ws, skill: m });
    assert.equal(bad.ok, false);
  });
});

describe("Clerk: catalog lookup", () => {
  test("skill ids resolve through skills/index.json", async () => {
    const { baseDir, ws } = await baseAndWorkspace({}, { "artifacts/workflow.json": JSON.stringify({ shape: "chain", steps: [{ skill: "build-contract-project" }, { skill: "adversarial-review" }] }) });
    const r = await verifySubmission({ workspaceDir: ws, baseDir, skill: "workflow-planner" });
    assert.equal(r.skill, "workflow-planner");
    assert.equal(r.ok, true, JSON.stringify(r.checks));
    await assert.rejects(verifySubmission({ workspaceDir: ws, skill: "eth-security" }), /reference skill/);
  });
});
