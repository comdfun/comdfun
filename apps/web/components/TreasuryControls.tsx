"use client";
// Owner controls for the Flywheel, shown only to the connected wallet that owns it (the Admin). Three things the
// firm does by hand, in the order they come up after the Pons graduation: point the Flywheel at the swapper, give the
// swapper the key of the Pons COMD/ETH pool (fee, tick spacing, hooks), and time a buyback. Every action is a normal
// transaction from the owner's wallet; nothing here is callable by anyone else (the contracts enforce that).
import { useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import type { Abi, Address, Hex } from "viem";
import { contract } from "@/lib/contracts";
import { useRead } from "@/lib/useChain";
import { units } from "@/lib/format";
import { TxButton } from "./tx/TxButton";
import { celebrate } from "@/lib/fx";

const ZERO = "0x0000000000000000000000000000000000000000";

export function TreasuryControls() {
  const { address } = useAccount();
  const pub = usePublicClient();
  const fw = contract("Flywheel");
  const sw = contract("Swapper");
  const { writeContractAsync } = useWriteContract();

  const owner = useRead<string>("Flywheel", "owner", []);
  const fwSwapper = useRead<string>("Flywheel", "swapper", [], undefined, { watch: true });
  const buckets = useRead<readonly [bigint, bigint]>("Flywheel", "bucketBalances", [], undefined, { watch: true });
  const paused = useRead<boolean>("Flywheel", "paused", []);
  const configured = useRead<boolean>("Swapper", "configured", [], undefined, { watch: true });
  const curFee = useRead<number>("Swapper", "fee", []);
  const curSpacing = useRead<number>("Swapper", "tickSpacing", []);
  const curHooks = useRead<string>("Swapper", "hooks", []);

  const [fee, setFee] = useState("3000");
  const [spacing, setSpacing] = useState("60");
  const [hooks, setHooks] = useState(ZERO);
  const [minOutNote, setMinOutNote] = useState<string | null>(null);

  const isOwner = !!address && !!owner.value && owner.value.toLowerCase() === address.toLowerCase();
  if (!fw.address || !isOwner) return null;

  const wired = !!sw.address && !!fwSwapper.value && fwSwapper.value.toLowerCase() === sw.address.toLowerCase();
  const buybackWei = buckets.value?.[0] ?? 0n;
  const hooksOk = /^0x[0-9a-fA-F]{40}$/.test(hooks);
  const feeN = Number(fee), spacingN = Number(spacing);
  const keyOk = Number.isInteger(feeN) && feeN >= 0 && feeN < 1_000_000 && Number.isInteger(spacingN) && spacingN > 0 && hooksOk;

  return (
    <div className="card c-gold" style={{ display: "grid", gap: 14, marginTop: 14 }}>
      <span className="label">Treasury controls · you are the Flywheel owner</span>

      <div style={{ display: "grid", gap: 8 }}>
        <b>1 · Swapper</b>
        <span className="small muted">
          Flywheel.swapper() is {fwSwapper.value && fwSwapper.value !== ZERO ? <code>{fwSwapper.value}</code> : <em>not set</em>}
          {sw.address ? <> · deployed swapper <code>{sw.address}</code></> : null}
          {wired ? <span className="ok"> · wired</span> : null}
        </span>
        {!wired && sw.address && (
          <div className="btn-row">
            <TxButton label="Point the Flywheel at the swapper" run={() => writeContractAsync({ address: fw.address!, abi: fw.abi as Abi, functionName: "setSwapper", args: [sw.address] } as never)} onDone={() => { fwSwapper.refetch(); celebrate("Swapper set"); }} />
          </div>
        )}
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <b>2 · Pons pool key</b>
        <span className="small muted">
          {configured.value
            ? <>Configured: fee <code>{String(curFee.value)}</code> · tick spacing <code>{String(curSpacing.value)}</code> · hooks <code>{curHooks.value}</code>. Re-setting replaces it.</>
            : <>Not configured yet — buybacks revert until the swapper knows the COMD/ETH pool Pons created at graduation. Read the pool&apos;s fee, tick spacing and hooks address from Pons or the Uniswap v4 PoolManager <code>Initialize</code> event; the currencies (ETH, $COMD) are fixed in the contract.</>}
        </span>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <label className="small">Fee (pips) <input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="numeric" style={{ width: 110 }} /></label>
          <label className="small">Tick spacing <input value={spacing} onChange={(e) => setSpacing(e.target.value)} inputMode="numeric" style={{ width: 90 }} /></label>
          <label className="small" style={{ flex: 1, minWidth: 320 }}>Hooks <input value={hooks} onChange={(e) => setHooks(e.target.value.trim())} spellCheck={false} style={{ width: "100%" }} /></label>
        </div>
        <div className="btn-row">
          <TxButton label={configured.value ? "Replace the pool key" : "Set the pool key"} disabled={!sw.address || !keyOk}
            run={() => writeContractAsync({ address: sw.address!, abi: sw.abi as Abi, functionName: "setPoolKey", args: [feeN, spacingN, hooks as Address] } as never)}
            onDone={() => { configured.refetch(); curFee.refetch(); curSpacing.refetch(); curHooks.refetch(); celebrate("Pool key set"); }} />
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <b>3 · Buyback &amp; burn</b>
        <span className="small muted">
          Buyback bucket: <b>{units(buybackWei, 18, 5)} ETH</b>{paused.value ? <span className="err-text"> · Flywheel is paused</span> : null}.
          The whole bucket is swapped ETH → $COMD and sent to 0x…dEaD. The expected output is simulated first and
          <code> minOut</code> set to 97% of it, so a sandwich cannot take more than 3%. {minOutNote}
        </span>
        <div className="btn-row">
          <TxButton label="Buy back & burn now" disabled={!wired || !configured.value || buybackWei === 0n || !!paused.value || !pub}
            run={async () => {
              const sim = await pub!.simulateContract({ address: fw.address!, abi: fw.abi as Abi, functionName: "buyback", args: [0n], account: address as Address });
              const expected = BigInt((sim.result as bigint | undefined) ?? 0n);
              if (expected === 0n) throw new Error("the simulated buyback returns 0 $COMD — check the pool key and liquidity");
              const minOut = (expected * 97n) / 100n;
              setMinOutNote(`Last simulation: ${units(expected, 18, 2)} $COMD expected, minOut ${units(minOut, 18, 2)}.`);
              return writeContractAsync({ address: fw.address!, abi: fw.abi as Abi, functionName: "buyback", args: [minOut] } as never) as Promise<Hex>;
            }}
            onDone={() => { buckets.refetch(); celebrate("Bought back & burned"); }} />
        </div>
      </div>
    </div>
  );
}
