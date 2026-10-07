/**
 * Intake screen — matters a Counsel must never be handed.
 *
 * A matter's objective is free text that a holder's machine will act on. Most of what it can ask for is fine (that
 * is the product); a few things are not work at all but an attempt to use the Counsel against its own holder:
 * harvesting the machine's environment or credential files, shipping them somewhere, or rewriting the runtime the
 * Counsel loads on its next lease. These are refused at intake (POST /requests → 422 `refused`) and, for anything
 * already on the docket when this screen ships, blocked before dispatch.
 *
 * The screen is deliberately narrow: it matches the mechanics of harvesting and tampering, not topics. "Add a
 * .env.example", "rotate the API key in the README", "audit the auth module" all pass.
 */

type Rule = { re: RegExp; why: string };

const RULES: Rule[] = [
  // the process environment of the machine (where runtimes keep API keys)
  { re: /\/proc\/[^\s'"]*\/environ\b/i, why: "reads the machine's process environment" },
  { re: /\bprintenv\b/i, why: "dumps the machine's environment variables" },
  { re: /(^|[^\w.])env\s*(>|>>|\|)/m, why: "dumps the machine's environment variables" },
  { re: /\b(process\.env|os\.environ|System\.getenv\(\)|ENV\.to_h)\b[^\n]{0,80}\b(JSON\.stringify|json\.dumps|dump|write|print|send|post|upload|log)\b/i, why: "dumps the machine's environment variables" },
  { re: /\b(JSON\.stringify|json\.dumps|dump|write|print|send|post|upload|cat|echo)\b[^\n]{0,80}\b(process\.env|os\.environ)\b/i, why: "dumps the machine's environment variables" },
  // credential and key files of the holder
  { re: /(~|\$HOME|\/root|\/home\/[\w-]+)\/\.(ssh|aws|gnupg|netrc|npmrc|pypirc|docker\/config\.json|kube\/config|claude|codex|config\/comd|comd)\b/i, why: "reads the holder's credential or runtime files" },
  { re: /\b(id_rsa|id_ed25519|id_ecdsa)\b/i, why: "reads the holder's SSH keys" },
  { re: /\.aws\/credentials|\.netrc\b|\.git-credentials\b|\.docker\/config\.json/i, why: "reads the holder's credential files" },
  { re: /\b(keychain|security find-generic-password|secret-tool|credential manager)\b/i, why: "reads the holder's credential store" },
  // the Counsel's own runtime: skills and settings it loads next time
  { re: /\/app\/skills\b|\/app\/\.comd\b|\/app\/config\b/i, why: "writes into the Counsel's own runtime" },
  { re: /\b(\.claude|\.codex|\.comd)\/(settings|config|hooks|skills|commands|agents)\b/i, why: "writes into the Counsel's own runtime" },
  // shipping anything of the above off the machine
  { re: /\b(curl|wget|nc|ncat|socat)\b[^\n]{0,120}\b(environ|printenv|\.ssh|id_rsa|credentials|\.netrc)\b/i, why: "sends the holder's secrets off the machine" },
  { re: /\b(environ|printenv|\.ssh|id_rsa|credentials)\b[^\n]{0,120}\b(curl|wget|nc|ncat|socat|base64)\b/i, why: "sends the holder's secrets off the machine" },
];

/** A reason this objective is refused, or null when it is ordinary work. */
export function screenObjective(text: unknown): string | null {
  if (typeof text !== "string" || !text) return null;
  const t = text.replace(/\\\n/g, " ");
  for (const r of RULES) if (r.re.test(t)) return r.why;
  return null;
}

/** Every free-text field of a job body that a Counsel will act on. */
export function screenJobBody(body: Record<string, unknown>): { path: string; why: string }[] {
  const out: { path: string; why: string }[] = [];
  const o = screenObjective(body.objective);
  if (o) out.push({ path: "objective", why: o });
  if (Array.isArray(body.steps)) body.steps.forEach((s, i) => { const w = screenObjective((s as Record<string, unknown>)?.objective); if (w) out.push({ path: `steps[${i}].objective`, why: w }); });
  const c = screenObjective(body.context);
  if (c) out.push({ path: "context", why: c });
  return out;
}
