"use client";
import { useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { contract } from "@/lib/contracts";
import { units } from "@/lib/format";
import { ConnectButton } from "./ConnectButton";
import { celebrate } from "@/lib/fx";

/** Claim a contributor allocation from ContributorDistributor using the frozen tree served by /api/claim. */
export function ClaimBox({ launchId, onchainLaunchId }: { launchId: string; onchainLaunchId?: number | null }) {
  const { address } = useAccount();
  const [claim, setClaim] = useState<{ root: string; amount: string; proof: `0x${string}`[]; launchNumber?: number; onchainLaunchId?: number | null; unlockAt?: number } | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const dist = contract("ContributorDistributor");
  const { writeContractAsync, isPending, data: tx } = useWriteContract();
  // ContributorDistributor is keyed by ProjectFactory's launch id (leaves are (launchId, account, amount)), not by
  // Chambers' launch number
  const idKnown = claim?.onchainLaunchId ?? onchainLaunchId;
  const chainLaunchId = BigInt(idKnown ?? 0);
  const { data: unlockAt } = useReadContract({ ...dist, functionName: "unlockAt", args: [chainLaunchId], query: { enabled: !!dist.address && idKnown != null } } as never);
  const { data: isClaimed, refetch } = useReadContract({ ...dist, functionName: "claimed", args: [chainLaunchId, address], query: { enabled: !!dist.address && idKnown != null && !!address } } as never);
  const locked = unlockAt != null && Number(unlockAt) * 1000 > Date.now();
  const look = async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/claim?launch=${launchId}&wallet=${address?.toLowerCase()}`);
      const j = await r.json();
      setClaim(j.claim);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="folder c-lime" data-tab="Contributor claim">
      <h3>Claim your share</h3>
      <p className="small muted">Wallets that worked on this incorporation or were connected in the window can claim their share once the lock ends.</p>
      {!address ? <ConnectButton /> : claim === undefined ? (
        <button className="btn sm" type="button" onClick={look}>Look up my claim</button>
      ) : claim === null ? (
        <p className="small">Nothing to claim for this wallet.</p>
      ) : (
        <div className="stack">
          <div className="num" style={{ fontSize: 40, color: "var(--lime)", lineHeight: 1 }}>{units(claim.amount, 18, 2)}</div>
          {locked && <p className="small muted">Unlocks {new Date(Number(unlockAt) * 1000).toUTCString()}</p>}
          {isClaimed === true ? <p className="small ok">Claimed.</p> : (
          <button
            className="btn primary lime"
            type="button"
            disabled={!dist.address || isPending || idKnown == null}
            onClick={async () => {
              setErr(null);
              try {
                await writeContractAsync({ ...dist, address: dist.address!, functionName: "claim", args: [chainLaunchId, address, BigInt(claim.amount), claim.proof] } as never);
                celebrate("Claimed");
                setTimeout(() => refetch(), 3000);
              } catch (e) {
                setErr((e as Error).message.split("\n")[0]);
              }
            }}
          >
            {isPending ? "Claiming…" : "Claim"}
          </button>
          )}
          {!dist.address && <p className="small muted">ContributorDistributor address not configured.</p>}
          {tx && <p className="small ok">Filed: {tx.slice(0, 18)}…</p>}
        </div>
      )}
      {err && <p className="small err-text">{err}</p>}
    </div>
  );
}
