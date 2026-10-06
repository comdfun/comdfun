"use client";
import { useReadContract } from "wagmi";
import type { Abi } from "viem";
import { contract } from "./contracts";
import { MOCK } from "./config";
import type { ContractName } from "./abi-fallback";

/**
 * Read one view function. When the contract address is not configured: in mock mode returns `mockValue`
 * (flagged `mock: true`), otherwise `missing: true` so the UI can say "not deployed".
 */
export function useRead<T>(name: ContractName, functionName: string, args: readonly unknown[] = [], mockValue?: T, opts: { enabled?: boolean; watch?: boolean } = {}) {
  const c = contract(name);
  const enabled = !!c.address && (opts.enabled ?? true);
  const q = useReadContract({
    address: c.address,
    abi: c.abi as Abi,
    functionName,
    args,
    query: { enabled, refetchInterval: opts.watch ? 15_000 : false },
  } as never) as { data?: unknown; isLoading: boolean; error: Error | null; refetch: () => void };
  if (!c.address) return { value: MOCK ? mockValue : undefined, mock: MOCK && mockValue !== undefined, missing: true, loading: false, error: null as Error | null, refetch: () => {} };
  return { value: q.data as T | undefined, mock: false, missing: false, loading: q.isLoading, error: q.error, refetch: q.refetch };
}
