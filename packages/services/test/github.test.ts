import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createBlobStore, publishRepo, repoSlug } from "../src/index.ts";
import { cleanupAll, tempDir, writeTree } from "./helpers/util.ts";

after(cleanupAll);

const project = {
  "README.md": "# Escrow\n",
  "src/Escrow.sol": "// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\ncontract Escrow {}\n",
  "node_modules/junk/index.js": "ignored",
  ".env": "SECRET=1",
};

describe("publishRepo: dry run (no token)", () => {
  test("deterministic URLs/commit and a tarball in storage", async () => {
    const dir = await writeTree(await tempDir(), project);
    const store = createBlobStore({ STORAGE_DIR: await tempDir("svc-store-") });
    const a = await publishRepo({ jobId: "7f3e2a10-aaaa-bbbb", title: "Escrow: milestone payments!", dir, org: "comdfun", store, env: {} });
    const b = await publishRepo({ jobId: "7f3e2a10-aaaa-bbbb", title: "Escrow: milestone payments!", dir, org: "comdfun", store, env: {} });
    assert.equal(a.dryRun, true);
    assert.equal(a.repoUrl, "https://github.com/comdfun/escrow-milestone-payments-7f3e2a10");
    assert.match(a.commit, /^[0-9a-f]{40}$/);
    assert.equal(a.commit, b.commit);
    assert.equal(a.branch, "main");
    assert.equal(a.pullRequestUrl, undefined);
    assert.ok(a.tarball);
    const tgz = await store.get(a.tarball.hash);
    const tar = gunzipSync(tgz!.data).toString("latin1");
    assert.ok(tar.includes("escrow-milestone-payments-7f3e2a10/src/Escrow.sol"));
    assert.ok(!tar.includes("node_modules"), "dependencies are not filed");
    assert.ok(!tar.includes("SECRET=1"), ".env is never filed");

    const cont = await publishRepo({ jobId: "99aa", title: "x", dir, baseRepo: "https://github.com/comdfun/escrow-milestone-payments-7f3e2a10", store, env: {} });
    assert.equal(cont.branch, "job/99aa");
    assert.match(cont.pullRequestUrl!, /\/pull\/dry-run-[0-9a-f]{12}$/);
  });

  test("slugs", () => {
    assert.equal(repoSlug("In re: Ünïcode — Matter!", "ABCDEF123456"), "in-re-unicode-matter-abcdef12");
    assert.equal(repoSlug("!!!", "1"), "matter-1");
  });
});

describe("publishRepo: live mode against a fake GitHub API and a local bare remote", () => {
  test("creates the repo, pushes main, then opens a PR for a continuation", async () => {
    const remotes = await tempDir("svc-remotes-");
    const calls: string[] = [];
    const repos = new Map<string, any>();
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      calls.push(`${req.method} ${req.url}`);
      assert.equal(req.headers.authorization, "Bearer ghp_test");
      const send = (status: number, json: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json));
      let m;
      if (req.method === "GET" && (m = /^\/repos\/([^/]+)\/([^/?]+)$/.exec(req.url!))) {
        const r = repos.get(`${m[1]}/${m[2]}`);
        return r ? send(200, r) : send(404, { message: "Not Found" });
      }
      if (req.method === "POST" && (m = /^\/orgs\/([^/]+)\/repos$/.exec(req.url!))) {
        const full = `${m[1]}/${body.name}`;
        const bare = path.join(remotes, m[1], `${body.name}.git`);
        mkdirSync(path.dirname(bare), { recursive: true });
        execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
        const r = { full_name: full, html_url: `https://github.com/${full}`, default_branch: "main" };
        repos.set(full, r);
        return send(201, r);
      }
      if (req.method === "POST" && (m = /^\/repos\/([^/]+)\/([^/]+)\/pulls$/.exec(req.url!))) {
        return send(201, { html_url: `https://github.com/${m[1]}/${m[2]}/pull/1`, head: body.head, base: body.base });
      }
      send(500, { message: "unexpected" });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const apiBaseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    try {
      const dir = await writeTree(await tempDir(), project);
      const first = await publishRepo({ jobId: "job00001", title: "Escrow", dir, org: "comdfun", token: "ghp_test", apiBaseUrl, gitBaseUrl: `file://${remotes}`, env: {} });
      assert.equal(first.dryRun, false);
      assert.equal(first.created, true);
      assert.equal(first.repoUrl, "https://github.com/comdfun/escrow-job00001");
      assert.equal(first.branch, "main");
      const bare = path.join(remotes, "comdfun", "escrow-job00001.git");
      assert.equal(execFileSync("git", ["--git-dir", bare, "rev-parse", "main"]).toString().trim(), first.commit);
      const files = execFileSync("git", ["--git-dir", bare, "ls-tree", "-r", "--name-only", "main"]).toString().trim().split("\n");
      assert.deepEqual(files.sort(), ["README.md", "src/Escrow.sol"]);

      await writeTree(dir, { "src/Escrow.sol": "// v2\n" });
      const second = await publishRepo({ jobId: "job00002", title: "Escrow v2", dir, token: "ghp_test", baseRepo: "comdfun/escrow-job00001", apiBaseUrl, gitBaseUrl: `file://${remotes}`, env: {} });
      assert.equal(second.branch, "job/job00002");
      assert.equal(second.pullRequestUrl, "https://github.com/comdfun/escrow-job00001/pull/1");
      const parent = execFileSync("git", ["--git-dir", bare, "rev-parse", "job/job00002^"]).toString().trim();
      assert.equal(parent, first.commit, "continuation is committed on top of main");
      assert.ok(calls.includes("POST /orgs/comdfun/repos"));
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
