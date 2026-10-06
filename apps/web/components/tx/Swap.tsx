"use client";
import { useEffect, useState } from "react";
import { useAccount, useBalance, usePublicClient, useWriteContract } from "wagmi";
import { formatUnits, parseUnits, type Abi } from "viem";
import { contract } from "@/lib/contracts";
import { MOCK, TAX_BPS_DEFAULT } from "@/lib/config";
import { MOCK_CHAIN } from "@/lib/mock-chain";
import { useRead } from "@/lib/useChain";
import { units } from "@/lib/format";
import { celebrate } from "@/lib/fx";
import { TxButton } from "./TxButton";
import { MockTag, NotDeployed } from "../Mocked";

const pctOf = (v: bigint, bps: number) => (v * BigInt(bps)) / 10_000n;

/**
 * ETH ↔ $COMD on the official pool through ComdRouter. Quotes come from quoteETHForComd / quoteComdForETH
 * (simulated, never sent) and are net of the 5% ETH tax that the ComdTaxHook forwards to the Flywheel.
 */
export function Swap({ initialSide = "buy" }: { initialSide?: "buy" | "sell" }) {
  const [side, setSide] = useState<"buy" | "sell">(initialSide);
  const [amt, setAmt] = useState("");
  const [slip, setSlip] = useState(1);
  const [out, setOut] = useState<bigint | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const { address } = useAccount();
  const router = contract("ComdRouter");
  const token = contract("ComdToken");
  const client = usePublicClient();
  const eth = useBalance({ address, query: { enabled: !!address } });
  const bal = useRead<bigint>("ComdToken", "balanceOf", [address], 0n, { enabled: !!address, watch: true });
  const allowance = useRead<bigint>("ComdToken", "allowance", [address, router.address], 0n, { enabled: !!address && !!router.address });
  const taxRead = useRead<number>("ComdTaxHook", "taxBps", [], TAX_BPS_DEFAULT);
  const taxBps = Number(taxRead.value ?? TAX_BPS_DEFAULT);
  const { writeContractAsync } = useWriteContract();
  let amountIn = 0n;
  try { amountIn = amt ? parseUnits(amt, 18) : 0n; } catch {}

  useEffect(() => {
    setOut(null); setQErr(null);
    if (!amountIn) return;
    const t = setTimeout(async () => {
      if (!router.address) {
        if (MOCK) {
          const r = MOCK_CHAIN.swap.comdPerEth;
          setOut(side === "buy" ? (amountIn - pctOf(amountIn, taxBps)) * r : (amountIn / r) - pctOf(amountIn / r, taxBps));
        }
        return;
      }
      try {
        const r = await client!.simulateContract({ address: router.address, abi: router.abi as Abi, functionName: side === "buy" ? "quoteETHForComd" : "quoteComdForETH", args: [amountIn], account: address } as never);
        setOut(r.result as bigint);
      } catch (e) { setQErr((e as Error).message.split("\n")[0]); }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amt, side, router.address, taxBps]);

  const minOut = out != null ? (out * BigInt(Math.round((100 - slip) * 100))) / 10000n : 0n;
  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600);
  const needApprove = side === "sell" && !!router.address && (allowance.value ?? 0n) < amountIn;
  const inSym = side === "buy" ? "ETH" : "COMD";
  const outSym = side === "buy" ? "COMD" : "ETH";
  const have = side === "buy" ? eth.data?.value : bal.value;
  // the tax is always ETH: 5% of ETH in on a buy; 5% of the gross ETH out on a sell (net out = gross × 0.95)
  const taxEth = side === "buy" ? pctOf(amountIn, taxBps) : out != null ? (out * BigInt(taxBps)) / BigInt(10_000 - taxBps) : null;
  const pct = (taxBps / 100).toFixed(taxBps % 100 ? 1 : 0);
  const half = (taxBps / 200).toFixed(taxBps % 200 ? 1 : 0);

  return (
    <div className="folder c-gold" data-tab={side === "buy" ? "Buy $COMD" : "Sell $COMD"} style={{ display: "grid", gap: 14 }}>
      {!router.address && !MOCK && <NotDeployed name="ComdRouter" />}
      <div className="seg" role="group" aria-label="Direction">
        <button type="button" aria-pressed={side === "buy"} onClick={() => setSide("buy")}>Buy $COMD</button>
        <button type="button" aria-pressed={side === "sell"} onClick={() => setSide("sell")}>Sell $COMD</button>
      </div>
      <div className="field">
        <label htmlFor="swap-in">You pay</label>
        <div className="amount">
          <input id="swap-in" inputMode="decimal" placeholder="0.0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} />
          {have != null && <button type="button" className="max" onClick={() => setAmt(formatUnits(side === "buy" && have > 10n ** 15n ? have - 10n ** 15n : have, 18))}>Max</button>}
          <span className="unit">{inSym}</span>
        </div>
        <span className="hint">Balance: {units(have, 18, 4)} {inSym}</span>
      </div>
      <div className="field">
        <span className="label">You receive, after the tax<MockTag on={!router.address && MOCK} /></span>
        <div className="num" style={{ fontSize: 40, lineHeight: 1, color: "var(--gold)" }}>{out != null ? units(out, 18, side === "buy" ? 2 : 6) : "—"} <span className="muted" style={{ fontSize: 20 }}>{outSym}</span></div>
        {qErr && <span className="small err-text">{qErr}</span>}
      </div>
      <div className="taxline" aria-label="Flywheel tax">
        <div className="split"><span className="label" style={{ color: "var(--pink)" }}>Flywheel tax · {pct}% in ETH</span><span className="num" style={{ fontSize: 20, color: "var(--pink)" }}>{taxEth != null && amountIn ? `${units(taxEth, 18, 6)} ETH` : "—"}</span></div>
        <div className="taxbar" aria-hidden="true"><span className="c-crimson" style={{ width: "50%" }} /><span className="c-violet" style={{ width: "50%" }} /></div>
        <div className="small muted">{half}% buyback &amp; burn · {half}% Counsel floor sweeps</div>
      </div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="label">Slippage</span>
        <div className="seg" role="group" aria-label="Slippage tolerance">
          {[0.5, 1, 3].map((s) => <button key={s} type="button" aria-pressed={slip === s} onClick={() => setSlip(s)}>{s}%</button>)}
        </div>
      </div>
      <div className="small muted">Minimum received: {out != null ? units(minOut, 18, 6) : "—"} {outSym}. The quote already includes the {pct}% tax.</div>
      {needApprove ? (
        <TxButton label="Approve COMD" run={() => writeContractAsync({ address: token.address!, abi: token.abi as Abi, functionName: "approve", args: [router.address!, amountIn] } as never)} onDone={allowance.refetch} />
      ) : (
        <TxButton
          label={side === "buy" ? "Buy $COMD" : "Sell $COMD"}
          disabled={!router.address || !amountIn || out == null}
          run={() =>
            side === "buy"
              ? writeContractAsync({ address: router.address!, abi: router.abi as Abi, functionName: "swapExactETHForComd", args: [minOut, address!, deadline()], value: amountIn } as never)
              : writeContractAsync({ address: router.address!, abi: router.abi as Abi, functionName: "swapExactComdForETH", args: [amountIn, minOut, address!, deadline()] } as never)
          }
          onDone={() => { setAmt(""); bal.refetch(); eth.refetch(); celebrate("Filed"); }}
        />
      )}
    </div>
  );
}
