// Coins the site does not show: not in the list, not in search, and their page answers 404.
//
// The chain cannot be edited, so a coin made through the contract stays on chain; this is the site refusing to
// carry it. Matched by symbol and by name (so a coin that reuses the symbol with different casing or a `$` in front
// is caught too), and by address once known. More addresses can be added without a code change through
// NEXT_PUBLIC_HIDDEN_COINS (comma separated).

const SYMBOLS = ["CDOGE"];
const ADDRESSES: string[] = [];

const norm = (s: string | undefined | null) => (s ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
const extra = (process.env.NEXT_PUBLIC_HIDDEN_COINS || "").split(/[\s,]+/).map((a) => a.trim().toLowerCase()).filter(Boolean);
const HIDDEN_ADDR = new Set([...ADDRESSES, ...extra].map((a) => a.toLowerCase()));
const HIDDEN_SYM = new Set(SYMBOLS.map(norm));

export function isHiddenCoin(c: { address?: string | null; symbol?: string | null; name?: string | null }): boolean {
  if (c.address && HIDDEN_ADDR.has(c.address.toLowerCase())) return true;
  if (c.symbol && HIDDEN_SYM.has(norm(c.symbol))) return true;
  if (c.name && HIDDEN_SYM.has(norm(c.name))) return true;
  return false;
}
