"use client";
import { useEffect, useState } from "react";
import { useAccount, useSwitchChain, useWaitForTransactionReceipt } from "wagmi";
import { activeChain, explorerUrl } from "@/lib/chains";
import { ConnectButton } from "../ConnectButton";

/** Runs an async wallet action, shows pending/receipt state. */
export function TxButton({ label, run, disabled, primary = true, onDone }: { label: string; run: () => Promise<`0x${string}`>; disabled?: boolean; primary?: boolean; onDone?: () => void }) {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rc = useWaitForTransactionReceipt({ hash, query: { enabled: !!hash } });
  useEffect(() => {
    if (rc.isSuccess) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rc.isSuccess]);
  if (!address) return <ConnectButton className={`btn ${primary ? "primary" : ""}`} label="Connect" />;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <button
        type="button"
        className={`btn ${primary ? "primary" : ""}`}
        style={{ width: "100%" }}
        disabled={disabled || busy || rc.isLoading}
        onClick={async () => {
          setErr(null);
          setBusy(true);
          try {
            if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
            setHash(await run());
          } catch (e) {
            setErr((e as Error).message.split("\n")[0]);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Confirm in wallet…" : rc.isLoading ? "Pending…" : label}
      </button>
      {hash && <a className="small ext" href={explorerUrl("tx", hash)} target="_blank" rel="noreferrer">{rc.isSuccess ? "Filed." : "Submitted."} {hash.slice(0, 14)}…</a>}
      {err && <span className="small err-text" role="alert">{err}</span>}
    </div>
  );
}
