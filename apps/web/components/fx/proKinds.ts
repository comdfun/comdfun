// The cICM films' names and lengths, in a plain module so the server page can route on them
// (a "use client" module only hands the server references to its components, not its values).
export type ProKind = "icmx" | "icmeth" | "icmagents" | "icmburn" | "icmsettle" | "icmmodels" | "icmeco";
export const PRO_KINDS: ProKind[] = ["icmx", "icmeth", "icmagents", "icmburn", "icmsettle", "icmmodels", "icmeco"];
export const PRO_LENGTH: Record<ProKind, number> = { icmx: 38_000, icmeth: 32_000, icmagents: 28_000, icmburn: 28_000, icmsettle: 29_000, icmmodels: 28_000, icmeco: 28_000 };
