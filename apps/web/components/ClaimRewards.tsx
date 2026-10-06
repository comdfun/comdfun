"use client";
import { useEffect, useState } from "react";
import { useAccount, useReadContracts, useWriteContract } from "wagmi";
import type { Abi, Address } from "viem";
import type { SeatReward } from "@/lib/types";
import { addressOf, contract } from "@/lib/contracts";
import { MOCK } from "@/lib/config";
import { units } from "@/lib/format";
import { celebrate } from "@/lib/fx";
import { ConnectButton } from "./ConnectButton";
import { TxButton } from "./tx/TxButton";

/**
 * Seat rewards (RewardDistributor), paid in COMD: 4.5% of every COMD the official pool trims plus 80% of job revenue
 * (RevenueRouter). The API publishes one Merkle root per (epoch, asset) with each seat's proof under
 * GET /wallets/:holder/earnings `rewards[]`. The current holder claims COMD with claim(epoch, tokenId, amount, proof);
 * any other asset uses claimToken(asset, epoch, tokenId, amount, proof). Only `posted` roots are claimable.
 */
export function ClaimRewards({ tokenId, owner }: { tokenId: string; owner: string | null }) {
  const { address } = useAccount();
  const dist = contract("RewardDistributor");
  const company = addressOf("ComdToken")?.toLowerCase();
  const [rows, setRows] = useState<SeatReward[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const { writeContractAsync } = useWriteContract();
  useEffect(() => {
    if (!owner) return setRows([]);
    fetch(`/api/wallets/${owner}/earnings`)
      .then((r) => r.json())
      .then((j) => setRows(((j.rewards ?? []) as SeatReward[]).filter((x) => String(x.tokenId) === String(tokenId) && x.status !== "failed" && x.status !== "expired").sort((a, b) => b.epoch - a.epoch)))
      .catch((e) => {
        setErr((e as Error).message);
        setRows([]);
      });
  }, [owner, tokenId]);
  const isEth = (r: SeatReward) => !!r.asset && /^0x0{40}$/i.test(r.asset);
  const isCompany = (r: SeatReward) => !isEth(r) && (!r.asset || r.asset.toLowerCase() === company || r.symbol === "COMD");
  const symOf = (r: SeatReward) => r.symbol ?? (isEth(r) ? "ETH" : "COMD");
  const key = (r: SeatReward) => `${r.epoch}:${(r.asset ?? "company").toLowerCase()}`;
  const claimed = useReadContracts({
    contracts: (rows ?? []).map((r) =>
      isCompany(r)
        ? { address: dist.address!, abi: dist.abi as Abi, functionName: "claimed", args: [BigInt(r.epoch), BigInt(tokenId)] }
        : { address: dist.address!, abi: dist.abi as Abi, functionName: "claimedToken", args: [r.asset as Address, BigInt(r.epoch), BigInt(tokenId)] },
    ),
    query: { enabled: !!dist.address && !!rows?.length },
  });
  const isClaimed = (i: number, r: SeatReward) => done.has(key(r)) || claimed.data?.[i]?.result === true;
  const open = (rows ?? []).filter((r, i) => r.status === "posted" && !isClaimed(i, r));
  const totals = new Map<string, { amount: bigint; decimals: number }>();
  for (const r of open) {
    const sym = symOf(r);
    const t = totals.get(sym) ?? { amount: 0n, decimals: r.decimals ?? 18 };
    t.amount += BigInt(r.amount);
    totals.set(sym, t);
  }
  const isHolder = !!address && !!owner && address.toLowerCase() === owner.toLowerCase();

  return (
    <div className="folder c-lime" data-tab="Counsel rewards">
      <div className="split">
        <h3 style={{ margin: 0, color: "var(--lime)" }}>Claim counsel rewards</h3>
        {rows && rows.length > 0 && <span className="badge ok">{rows.length} reward{rows.length === 1 ? "" : "s"}</span>}
      </div>
      <p className="small muted" style={{ margin: "8px 0 12px" }}>Seats earn $COMD: 4.5% of every COMD the pool trims and 80% of every job payment, split by accepted work each epoch. The current holder claims; unclaimed epochs expire.</p>
      {rows === null ? (
        <p className="small muted">Reading the reward roots…</p>
      ) : rows.length === 0 ? (
        <p className="small muted">No reward epochs posted for this seat yet.</p>
      ) : (
        <>
          <div className="row" style={{ gap: 18, marginBottom: 12 }}>
            {(totals.size ? [...totals.entries()] : [["COMD", { amount: 0n, decimals: 18 }] as const]).map(([sym, t]) => (
              <div className="stat c-lime" key={sym}>
                <span className="v">{units(t.amount, t.decimals, 2)}</span>
                <span className="k">{sym} unclaimed</span>
              </div>
            ))}
          </div>
          <ul className="rows" style={{ marginBottom: 12 }}>
            {rows.map((r, i) => (
              <li key={key(r)} className="split" style={{ padding: "8px 0" }}>
                <span className="small"><span className="docket" style={{ color: "var(--lime)" }}>Epoch {r.epoch}</span> · {units(r.amount, r.decimals ?? 18, r.decimals === 6 ? 2 : 2)} {symOf(r)}</span>
                {isClaimed(i, r) ? (
                  <span className="badge ok fill">Claimed</span>
                ) : r.status !== "posted" ? (
                  <span className="badge" title="The root is posted once the epoch is funded">{r.status === "waiting_funds" ? "Awaiting funds" : "Pending"}</span>
                ) : isHolder ? (
                  <span style={{ minWidth: 120 }}>
                    <TxButton
                      label="Claim"
                      disabled={!dist.address}
                      run={() =>
                        isCompany(r)
                          ? writeContractAsync({ address: dist.address!, abi: dist.abi as Abi, functionName: "claim", args: [BigInt(r.epoch), BigInt(tokenId), BigInt(r.amount), r.proof] } as never)
                          : writeContractAsync({ address: dist.address!, abi: dist.abi as Abi, functionName: "claimToken", args: [r.asset as Address, BigInt(r.epoch), BigInt(tokenId), BigInt(r.amount), r.proof] } as never)
                      }
                      onDone={() => {
                        setDone((d) => new Set(d).add(key(r)));
                        celebrate("Claimed");
                      }}
                    />
                  </span>
                ) : (
                  <span className="badge">Open</span>
                )}
              </li>
            ))}
          </ul>
          {!address ? <ConnectButton className="btn sm lime" label="Connect the holder's wallet" /> : !isHolder ? <p className="small muted" style={{ margin: 0 }}>Only the wallet holding this seat can claim.</p> : null}
          {!dist.address && <p className="small muted" style={{ marginTop: 8 }}>RewardDistributor is not deployed on this chain yet{MOCK ? " (mock data)" : ""}.</p>}
        </>
      )}
      {err && <p className="small err-text">{err}</p>}
    </div>
  );
}
