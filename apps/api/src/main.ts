/**
 * Entry point: `node dist/main.js` (production) or `tsx src/main.ts` (dev).
 * Under plain node, a resolve hook lets `@company/abi` (TypeScript source with `.js` specifiers) load; then the app
 * is imported dynamically so the hook is active first.
 */
import { register } from "node:module";

if (import.meta.url.endsWith(".js")) register("./ts-resolve.js", import.meta.url);

const { loadConfig } = await import("./config.ts");
const { App } = await import("./app.ts");

const cfg = loadConfig();
const app = await App.create({ cfg });
const port = await app.listen();
const h = app.services.status();
console.log(`[chambers] listening on ${cfg.host}:${port} · chain ${cfg.chainId} · store ${app.store.driver} · storage ${app.blobs.driver} · services ${app.services.name} · skills ${app.skills.source} (${app.skills.all().length}) · payments ${app.paymentsEnabled ? app.settler.mode : "off"} · clerk ${h.verifier.mode} · registrar ${h.deployer.mode}`);
if (!app.chain.configured) console.warn("[chambers] RPC_URL not set: seat ownership, pairing and oracle windows are unavailable (GET /health reports degraded)");

const stop = async (sig: string) => {
  console.log(`[chambers] ${sig}: shutting down`);
  await app.close().catch((e) => console.error(e));
  process.exit(0);
};
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
