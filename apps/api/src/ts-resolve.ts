/**
 * Node module-resolution hook for plain `node dist/main.js`: workspace packages that ship TypeScript sources with
 * `.js` import specifiers (`@company/abi` → `./abis/index.js` next to `index.ts`) resolve to the `.ts` file when no
 * `.js` exists. Node 22.18+ strips the types. Registered by main.ts; not needed under tsx (tests, dev).
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Next = (specifier: string, context: { parentURL?: string }) => Promise<unknown>;

export async function resolve(specifier: string, context: { parentURL?: string }, next: Next): Promise<unknown> {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js") && context.parentURL?.endsWith(".ts")) {
    const js = new URL(specifier, context.parentURL);
    if (!existsSync(fileURLToPath(js))) {
      const ts = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(ts))) return next(ts.href, context);
    }
  }
  return next(specifier, context);
}
