/**
 * Which workspace packages the control plane needs at runtime, worked out rather than written down.
 *
 * The api image used to carry three hand-kept lists of them: what to copy into the runtime layer, what to
 * install production dependencies for, and what to smoke-test on import. Adding `@company/icm` to the api and
 * forgetting all three shipped an image whose compiled code imported a package whose source was never copied,
 * and the process died on its first import with ERR_MODULE_NOT_FOUND. The smoke test on the last line of the
 * Dockerfile exists to catch exactly that, and could not, because it was one of the lists that was out of date.
 *
 * So there is one source of truth now: the `@company/*` entries in apps/api/package.json's `dependencies`.
 * Declaring a dependency is the thing nobody can forget, because the code does not typecheck without it.
 *
 *   node infra/docker/runtime-workspaces.mjs --names   @company/abi @company/icm …
 *   node infra/docker/runtime-workspaces.mjs --dirs    packages/abi packages/icm …
 *   node infra/docker/runtime-workspaces.mjs --w       -w @company/abi -w @company/icm …
 *
 * Directories are resolved by reading each manifest's own `name`, not by rewriting the scope, so a package
 * whose folder is not named after it still lands in the right place.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, parse } from "node:path";
import { fileURLToPath } from "node:url";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));

/**
 * The repo root, found by walking up from the working directory for the manifest that declares the workspaces.
 * Not resolved from this file's own location: the image copies the script out of the tree, next to the node
 * install, where nothing above it is the repo. The working directory is /app in both stages that run it.
 */
function repoRoot() {
  const tried = [];
  for (let dir = resolve(process.cwd()); ; dir = dirname(dir)) {
    const manifest = join(dir, "package.json");
    tried.push(manifest);
    if (existsSync(manifest)) {
      try {
        if (read(manifest).workspaces) return dir;
      } catch { /* keep walking: a manifest that will not parse is not the root we want */ }
    }
    if (dir === parse(dir).root) break;
  }
  // last resort, for anyone running this from inside the repo's own tree
  const beside = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  if (existsSync(join(beside, "package.json"))) return beside;
  console.error(`[runtime-workspaces] no workspace root above ${process.cwd()}. Looked at:\n  ${tried.join("\n  ")}`);
  process.exit(1);
}

const root = repoRoot();

/** Every workspace package in packages/, as name → directory relative to the repo root. */
function packageDirs() {
  const out = new Map();
  const base = join(root, "packages");
  if (!existsSync(base)) return out;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = join(base, entry.name, "package.json");
    if (!existsSync(manifest)) continue;
    try {
      out.set(read(manifest).name, `packages/${entry.name}`);
    } catch {
      // a manifest that will not parse is npm's problem to report, not this script's
    }
  }
  return out;
}

const api = read(join(root, "apps", "api", "package.json"));
const names = Object.keys(api.dependencies ?? {}).filter((n) => n.startsWith("@company/")).sort();

const dirs = packageDirs();
const missing = names.filter((n) => !dirs.has(n));
if (missing.length) {
  console.error(
    `[runtime-workspaces] apps/api depends on ${missing.join(", ")}, which no package under packages/ declares.\n` +
    `Either the dependency is wrong or the package lives somewhere this script does not look.`,
  );
  process.exit(1);
}

const mode = process.argv[2] ?? "--names";

// --check actually imports each one, which is the only proof that the image carries it and that plain node can
// load it. Run from somewhere under the repo root, so bare specifiers resolve against its node_modules.
if (mode === "--check") {
  const failed = [];
  for (const name of names) {
    try {
      await import(name);
    } catch (e) {
      failed.push(`  ${name}: ${e.message.split("\n")[0]}`);
    }
  }
  if (failed.length) {
    console.error(`[runtime-workspaces] the api depends on packages this image cannot import:\n${failed.join("\n")}`);
    process.exit(1);
  }
  console.log(`[runtime-workspaces] imports ok: ${names.join(", ")}`);
  process.exit(0);
}

const out =
  mode === "--dirs" ? names.map((n) => dirs.get(n))
  : mode === "--w" ? names.map((n) => `-w ${n}`)
  : mode === "--json" ? [JSON.stringify(names)]
  : names;
process.stdout.write(`${out.join(" ")}\n`);
