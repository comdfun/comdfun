// Release build: one ESM file (dist/cli.js) with @company/protocol inlined; viem and ws stay npm dependencies.
import { build } from "esbuild";
await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["viem", "viem/*", "ws"],
  sourcemap: true,
  logLevel: "info",
});
