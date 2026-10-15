"use client";
// The collection's live state, and the agents the connected wallet holds.
import { useEffect, useState } from "react";

export interface CollectionState { owners: (string | null)[]; online: number[]; working: number[] }

let cache: { at: number; data: CollectionState } | null = null;

export function useCollection(): CollectionState | null {
  const [s, setS] = useState<CollectionState | null>(cache?.data ?? null);
  useEffect(() => {
    if (cache && Date.now() - cache.at < 15_000) return;
    fetch("/api/collection", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: CollectionState) => { cache = { at: Date.now(), data: d }; setS(d); })
      .catch(() => setS({ owners: [], online: [], working: [] }));
  }, []);
  return s;
}

/** Token ids held by `address`, lowest first. */
export function heldBy(s: CollectionState | null, address: string | undefined): number[] {
  if (!s || !address) return [];
  const a = address.toLowerCase();
  const out: number[] = [];
  s.owners.forEach((o, i) => { if (o === a) out.push(i); });
  return out;
}
