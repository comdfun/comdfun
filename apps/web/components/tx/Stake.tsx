"use client";
import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { formatUnits, parseUnits, type Abi } from "viem";
import { contract } from "@/lib/contracts";
import { MOCK } from "@/lib/config";
import { MOCK_CHAIN } from "@/lib/mock-chain";
import { useRead } from "@/lib/useChain";
import { units } from "@/lib/format";
import { celebrate } from "@/lib/fx";
import { TxButton } from "./TxButton";
import { MockTag, NotDeployed } from "../Mocked";

const E18 = 10n ** 18n;

/**
 * Stake COMD for sCOMD (StakedComd, ERC-4626). Stake = approve + deposit(assets, receiver); unstake =
 * redeem(shares, receiver, owner). The share price rises as the RewardDripper streams COMD into the vault.
 */
export function Stake() {
  const [side, setSide] = useState<"stake" | "unstake">("stake");
  const [amt, setAmt] = useState("");
  const { address } = useAccount();
  const vault = contract("StakedComd");
  const token = contract("ComdToken");
  const { writeContractAsync } = useWriteContract();
  const m = MOCK_CHAIN.stake;
  const comdBal = useRead<bigint>("ComdToken", "balanceOf", [address], 0n, { enabled: !!address, watch: true });
  const shares = useRead<bigint>("StakedComd", "balanceOf", [address], 0n, { enabled: !!address, watch: true });
  const allowance = useRead<bigint>("ComdToken", "allowance", [address, vault.address], 0n, { enabled: !!address && !!vault.address });
  // sCOMD may carry extra decimals (ERC-4626 decimals offset): read them, then price one whole share
  const dec = Number(useRead<number>("StakedComd", "decimals", [], 24).value ?? 24);
  const ONE = 10n ** BigInt(dec);
  const rate = useRead<bigint>("StakedComd", "convertToAssets", [ONE], (m.totalAssets * 10n ** 24n) / m.totalShares, { watch: true });
  const totalAssets = useRead<bigint>("StakedComd", "totalAssets", [], m.totalAssets, { watch: true });
  let amount = 0n;
  try { amount = amt ? parseUnits(amt, side === "stake" ? 18 : dec) : 0n; } catch {}
  const r = rate.value ?? E18; // COMD (18 dec) per one whole sCOMD
  const mine = shares.value != null ? (shares.value * r) / ONE : undefined;
  const out = side === "stake" ? (r ? (amount * ONE) / r : 0n) : (amount * r) / ONE;
  const decIn = side === "stake" ? 18 : dec;
  const decOut = side === "stake" ? dec : 18;
  const have = side === "stake" ? comdBal.value : shares.value;
  const needApprove = side === "stake" && !!vault.address && (allowance.value ?? 0n) < amount;
  const inSym = side === "stake" ? "COMD" : "sCOMD";
  const outSym = side === "stake" ? "sCOMD" : "COMD";
  const refresh = () => { setAmt(""); comdBal.refetch(); shares.refetch(); allowance.refetch(); totalAssets.refetch(); rate.refetch(); };

  return (
    <div className="folder c-cyan" data-tab={side === "stake" ? "Stake COMD" : "Unstake"} style={{ display: "grid", gap: 14 }}>
      {!vault.address && !MOCK && <NotDeployed name="StakedComd" />}
      <div className="seg" role="group" aria-label="Direction">
        <button type="button" aria-pressed={side === "stake"} onClick={() => { setSide("stake"); setAmt(""); }}>Stake</button>
        <button type="button" aria-pressed={side === "unstake"} onClick={() => { setSide("unstake"); setAmt(""); }}>Unstake</button>
      </div>
      <div className="trade-stats">
        <div className="stat c-cyan"><span className="v">{units(mine, 18, 2)}</span><span className="k">Your stake, COMD<MockTag on={shares.mock} /></span></div>
        <div className="stat c-violet"><span className="v">{units(shares.value, dec, 2)}</span><span className="k">Your sCOMD</span></div>
        <div className="stat c-gold"><span className="v">{Number(formatUnits(r, 18)).toFixed(4)}</span><span className="k">COMD per sCOMD<MockTag on={rate.mock} /></span></div>
      </div>
      <div className="field">
        <label htmlFor="stake-in">{side === "stake" ? "Stake" : "Unstake"}</label>
        <div className="amount">
          <input id="stake-in" inputMode="decimal" placeholder="0.0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} />
          {have != null && have > 0n && <button type="button" className="max" onClick={() => setAmt(formatUnits(have, decIn))}>Max</button>}
          <span className="unit">{inSym}</span>
        </div>
        <span className="hint">Balance: {units(have, decIn, 4)} {inSym}</span>
      </div>
      <div className="field">
        <span className="label">You receive</span>
        <div className="num" style={{ fontSize: 40, lineHeight: 1, color: "var(--cyan)" }}>{amount ? units(out, decOut, 4) : "—"} <span className="muted" style={{ fontSize: 20 }}>{outSym}</span></div>
      </div>
      {needApprove ? (
        <TxButton label="Approve COMD" run={() => writeContractAsync({ address: token.address!, abi: token.abi as Abi, functionName: "approve", args: [vault.address!, amount] } as never)} onDone={allowance.refetch} />
      ) : (
        <TxButton
          label={side === "stake" ? "Stake COMD" : "Unstake"}
          disabled={!vault.address || !amount || (have != null && amount > have)}
          run={() =>
            side === "stake"
              ? writeContractAsync({ address: vault.address!, abi: vault.abi as Abi, functionName: "deposit", args: [amount, address!] } as never)
              : writeContractAsync({ address: vault.address!, abi: vault.abi as Abi, functionName: "redeem", args: [amount, address!, address!] } as never)
          }
          onDone={() => { refresh(); celebrate(side === "stake" ? "Staked" : "Filed"); }}
        />
      )}
      <p className="small muted" style={{ margin: 0 }}>No lockup and no fee. Rewards are not claimed: they raise the COMD each sCOMD redeems for. Shares cannot be redeemed in the block they were minted.</p>
    </div>
  );
}
