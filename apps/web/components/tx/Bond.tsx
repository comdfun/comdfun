"use client";
import { useState } from "react";
import { useAccount, useBalance, useWriteContract } from "wagmi";
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

/** Buy COMD from the bond reserve (the 6% trim share) with ETH at the owner-set price: buyWithEth(minOut) payable. */
export function Bond() {
  const [amt, setAmt] = useState("");
  const { address } = useAccount();
  const bond = contract("Bond");
  const { writeContractAsync } = useWriteContract();
  const m = MOCK_CHAIN.bond;
  const eth = useBalance({ address, query: { enabled: !!address } });
  const comdBal = useRead<bigint>("ComdToken", "balanceOf", [address], 0n, { enabled: !!address, watch: true });
  const enabled = useRead<boolean>("Bond", "enabled", [], m.enabled, { watch: true });
  const price = useRead<bigint>("Bond", "priceEth", [], m.priceEth, { watch: true });
  const reserve = useRead<bigint>("Bond", "reserve", [], m.reserve, { watch: true });
  let ethIn = 0n;
  try { ethIn = amt ? parseUnits(amt, 18) : 0n; } catch {}
  const quote = useRead<bigint>("Bond", "quote", [ethIn], price.value ? (ethIn * E18) / price.value : 0n, { enabled: ethIn > 0n });
  const out = ethIn ? quote.value ?? (price.value ? (ethIn * E18) / price.value : 0n) : 0n;
  const minOut = (out * 995n) / 1000n;
  const open = !!enabled.value;
  const over = reserve.value != null && out > reserve.value;
  const pricePerComd = price.value != null ? Number(formatUnits(price.value, 18)) : null;

  return (
    <div className="folder c-orange" data-tab="Bond · ETH → COMD" style={{ display: "grid", gap: 14 }}>
      {!bond.address && !MOCK && <NotDeployed name="Bond" />}
      <div className="trade-stats">
        <div className="stat c-orange"><span className="v">{units(reserve.value, 18, 0)}</span><span className="k">COMD in reserve<MockTag on={reserve.mock} /></span></div>
        <div className="stat c-gold"><span className="v">{pricePerComd != null ? (pricePerComd * 1e6).toFixed(2) : "—"}</span><span className="k">ETH per 1M COMD</span></div>
        <div className="stat c-violet"><span className="v">{bond.address || MOCK ? (open ? "Open" : "Shut") : "—"}</span><span className="k">Status</span></div>
      </div>
      {!open && (bond.address || MOCK) && <div className="notice warn small">The bond is not open yet. It opens when the firm enables it; the reserve keeps filling from trims meanwhile.</div>}
      <div className="field">
        <label htmlFor="bond-in">You pay</label>
        <div className="amount">
          <input id="bond-in" inputMode="decimal" placeholder="0.0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} />
          {eth.data?.value != null && eth.data.value > 10n ** 15n && <button type="button" className="max" onClick={() => setAmt(formatUnits(eth.data!.value - 10n ** 15n, 18))}>Max</button>}
          <span className="unit">ETH</span>
        </div>
        <span className="hint">Balance: {units(eth.data?.value, 18, 4)} ETH · {units(comdBal.value, 18, 2)} COMD</span>
      </div>
      <div className="field">
        <span className="label">You receive, at the fixed price<MockTag on={quote.mock} /></span>
        <div className="num" style={{ fontSize: 40, lineHeight: 1, color: "var(--orange)" }}>{ethIn ? units(out, 18, 2) : "—"} <span className="muted" style={{ fontSize: 20 }}>COMD</span></div>
        {over && <span className="small err-text">More than the reserve holds right now.</span>}
      </div>
      <TxButton
        label="Bond ETH"
        disabled={!bond.address || !open || !ethIn || !out || over}
        run={() => writeContractAsync({ address: bond.address!, abi: bond.abi as Abi, functionName: "buyWithEth", args: [minOut], value: ethIn } as never)}
        onDone={() => { setAmt(""); eth.refetch(); comdBal.refetch(); reserve.refetch(); celebrate("Bonded"); }}
      />
      <p className="small muted" style={{ margin: 0 }}>No tax: the bond is not a pool trade. COMD arrives in the same transaction; the ETH goes to the firm treasury.</p>
    </div>
  );
}
