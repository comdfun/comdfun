/**
 * Records Office (publisher): files accepted work as a GitHub repository in GITHUB_ORG.
 * REST via fetch; the tree is pushed with the git CLI using a one-shot Authorization header
 * (the token never lands in .git/config or in error messages).
 *
 * Without a token it runs in dry-run mode: deterministic fake URLs and commit, plus a .tar.gz
 * snapshot of the tree in the blob store.
 */
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBlobStore, type BlobStore } from "./blobstore.ts";
import { runSandboxed } from "./sandbox.ts";
import { tarGz } from "./tar.ts";
import { canonicalJson, hashTree, sha256Hex, walkFiles } from "./util.ts";

export interface PublishRepoInput {
  jobId: string;
  title: string;
  dir: string;
  org?: string;
  token?: string;
  /** "owner/name" or a GitHub URL of an existing repo to continue (opens a PR) */
  baseRepo?: string;
  /** branch to push; default main for new repos, job/<jobId> when continuing */
  branch?: string;
  description?: string;
  private?: boolean;
  /** used by dry-run for the snapshot tarball (default createBlobStore(env)) */
  store?: BlobStore;
  env?: Record<string, string | undefined>;
  /** default https://api.github.com */
  apiBaseUrl?: string;
  /** default https://github.com — remote is `${gitBaseUrl}/${owner}/${name}.git` */
  gitBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface PublishRepoResult {
  dryRun: boolean;
  repoUrl: string;
  fullName: string;
  branch: string;
  commit: string;
  pullRequestUrl?: string;
  created?: boolean;
  tarball?: { hash: string; url: string; bytes: number };
}

const PUBLISH_IGNORES = [".git", "node_modules", "out", "cache", "broadcast", ".env"];

export function repoSlug(title: string, jobId: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
  const short = jobId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 8);
  return `${slug || "matter"}-${short}`;
}

function parseRepo(ref: string): { owner: string; name: string } {
  const m = /(?:github\.com[/:])?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(ref.trim());
  if (!m) throw new Error(`cannot parse repository reference: ${ref}`);
  return { owner: m[1], name: m[2] };
}

export async function publishRepo(input: PublishRepoInput): Promise<PublishRepoResult> {
  const env = input.env ?? process.env;
  const org = input.org ?? env.GITHUB_ORG ?? "comdfun";
  const token = input.token ?? env.GITHUB_TOKEN;
  const { owner, name } = input.baseRepo ? parseRepo(input.baseRepo) : { owner: org, name: repoSlug(input.title, input.jobId) };
  if (!token) return dryRun(input, owner, name, env);
  return live(input, owner, name, token);
}

async function dryRun(input: PublishRepoInput, owner: string, name: string, env: Record<string, string | undefined>): Promise<PublishRepoResult> {
  const tree = await hashTree(input.dir, PUBLISH_IGNORES);
  const treeHash = sha256Hex(canonicalJson(Object.fromEntries(tree)));
  const commit = sha256Hex(`${input.jobId}\n${treeHash}`).slice(0, 40);
  const branch = input.branch ?? (input.baseRepo ? `job/${input.jobId}` : "main");
  const repoUrl = `https://github.com/${owner}/${name}`;
  const files = (await walkFiles(input.dir, PUBLISH_IGNORES)).filter((f) => f.type === "file");
  const entries = [];
  for (const f of files) entries.push({ path: `${name}/${f.path}`, data: await readFile(f.abs) });
  const tgz = tarGz(entries);
  const store = input.store ?? createBlobStore(env);
  const put = await store.put(tgz, { mediaType: "application/gzip" });
  return {
    dryRun: true,
    repoUrl,
    fullName: `${owner}/${name}`,
    branch,
    commit,
    pullRequestUrl: input.baseRepo ? `${repoUrl}/pull/dry-run-${commit.slice(0, 12)}` : undefined,
    tarball: { hash: put.hash, url: put.url, bytes: put.bytes },
  };
}

class GitHubApi {
  private readonly base: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  constructor(base: string, token: string, fetchImpl: typeof fetch) {
    this.base = base;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }
  async call(method: string, p: string, body?: unknown): Promise<{ status: number; json: any }> {
    const res = await this.fetchImpl(`${this.base.replace(/\/$/, "")}${p}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "comd-records-office",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { message: text };
    }
    return { status: res.status, json };
  }
}

async function live(input: PublishRepoInput, owner: string, name: string, token: string): Promise<PublishRepoResult> {
  const api = new GitHubApi(input.apiBaseUrl ?? "https://api.github.com", token, input.fetchImpl ?? fetch);
  const timeoutMs = input.timeoutMs ?? 300_000;
  let created = false;
  let repo = await api.call("GET", `/repos/${owner}/${name}`);
  if (repo.status === 404) {
    if (input.baseRepo) throw new Error(`base repository ${owner}/${name} not found`);
    repo = await api.call("POST", `/orgs/${owner}/repos`, {
      name,
      description: (input.description ?? input.title).slice(0, 350),
      private: input.private ?? false,
      has_issues: true,
      has_wiki: false,
      auto_init: false,
    });
    if (repo.status !== 201) throw new Error(`GitHub create repo ${owner}/${name}: HTTP ${repo.status} ${repo.json?.message ?? ""}`);
    created = true;
  } else if (repo.status !== 200) throw new Error(`GitHub get repo ${owner}/${name}: HTTP ${repo.status} ${repo.json?.message ?? ""}`);

  const defaultBranch: string = repo.json?.default_branch || "main";
  const branch = input.branch ?? (created || !input.baseRepo ? defaultBranch : `job/${input.jobId}`);
  const remote = `${(input.gitBaseUrl ?? "https://github.com").replace(/\/$/, "")}/${owner}/${name}.git`;
  const authHeader = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;

  const work = await mkdtemp(path.join(os.tmpdir(), "comd-publish-"));
  const git = async (args: string[], allowFail = false) => {
    const r = await runSandboxed("git", ["-c", `http.extraHeader=${authHeader}`, ...args], {
      cwd: work,
      network: true,
      timeoutMs,
      env: {
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: "Company.md Records Office",
        GIT_AUTHOR_EMAIL: "team@comd.fun",
        GIT_COMMITTER_NAME: "Company.md Records Office",
        GIT_COMMITTER_EMAIL: "team@comd.fun",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    });
    if (r.code !== 0 && !allowFail) {
      const msg = `${r.stderr || r.stdout}`.split(token).join("<token>").split(authHeader).join("<auth>");
      throw new Error(`git ${args[0]} failed: ${msg.trim().slice(-1500)}`);
    }
    return r;
  };
  try {
    await git(["init", "-q", "-b", branch]);
    await git(["remote", "add", "origin", remote]);
    let hasBase = false;
    if (!created) {
      const fetched = await git(["fetch", "-q", "--depth=1", "origin", defaultBranch], true);
      if (fetched.code === 0) {
        hasBase = true;
        await git(["checkout", "-q", "-B", branch, "FETCH_HEAD"]);
        await git(["rm", "-rq", "--ignore-unmatch", "."]);
      }
    }
    const files = (await walkFiles(input.dir, PUBLISH_IGNORES)).filter((f) => f.type === "file");
    for (const f of files) {
      const dest = path.join(work, f.path);
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(f.abs, dest);
    }
    await git(["add", "-A"]);
    const status = await git(["status", "--porcelain"]);
    if (status.stdout.trim() || !hasBase) {
      await git(["commit", "-q", "--allow-empty", "-m", `${input.title}\n\nMatter ${input.jobId}. Filed by the Company.md Records Office.`]);
    }
    const commit = (await git(["rev-parse", "HEAD"])).stdout.trim();
    const force = branch.startsWith("job/") ? ["--force"] : [];
    await git(["push", "-q", ...force, "origin", `HEAD:refs/heads/${branch}`]);

    let pullRequestUrl: string | undefined;
    if (hasBase && branch !== defaultBranch) {
      const pr = await api.call("POST", `/repos/${owner}/${name}/pulls`, {
        title: input.title.slice(0, 250),
        head: branch,
        base: defaultBranch,
        body: `Matter \`${input.jobId}\`, filed by the Company.md Records Office.`,
      });
      if (pr.status === 201) pullRequestUrl = pr.json.html_url;
      else if (pr.status === 422) {
        const existing = await api.call("GET", `/repos/${owner}/${name}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`);
        pullRequestUrl = existing.json?.[0]?.html_url;
      } else throw new Error(`GitHub open PR: HTTP ${pr.status} ${pr.json?.message ?? ""}`);
    }
    return {
      dryRun: false,
      repoUrl: repo.json?.html_url ?? `https://github.com/${owner}/${name}`,
      fullName: `${owner}/${name}`,
      branch,
      commit,
      pullRequestUrl,
      created,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
