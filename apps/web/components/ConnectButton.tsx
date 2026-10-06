"use client";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { useEffect, useRef, useState } from "react";
import { activeChain } from "@/lib/chains";
import { short } from "@/lib/format";

export function ConnectButton({ className = "btn sm", label = "Connect" }: { className?: string; label?: string }) {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!mounted) return <button className={className} type="button" disabled>{label}</button>;

  if (isConnected && address) {
    const wrong = chainId !== activeChain.id;
    return (
      <div className="pop" ref={ref} style={{ position: "relative" }}>
        <button type="button" className={wrong ? "btn sm danger" : className} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
          {wrong ? "Wrong chain" : short(address, 6, 4)}
        </button>
        {open && (
          <div role="menu" className="card" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", minWidth: 220, zIndex: 40, display: "grid", gap: 8 }}>
            <div className="label">Connected</div>
            <div className="small break">{address}</div>
            {wrong && (
              <button role="menuitem" type="button" className="btn sm primary" onClick={() => switchChain({ chainId: activeChain.id })}>
                Switch to {activeChain.name}
              </button>
            )}
            <a role="menuitem" className="btn sm" href={`/agents?owner=${address}`}>My counsel</a>
            <button role="menuitem" type="button" className="btn sm ghost" onClick={() => { disconnect(); setOpen(false); }}>
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className={className} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)} disabled={isPending}>
        {isPending ? "Connecting…" : label}
      </button>
      {open && (
        <div role="menu" className="card" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", minWidth: 240, zIndex: 40, display: "grid", gap: 8 }}>
          <div className="label">Choose a wallet</div>
          {/* EIP-6963 wallets announce themselves by name; the generic "injected" entry is the same provider then */}
          {connectors.filter((c, _i, all) => !(c.id === "injected" && all.some((o) => o.type === "injected" && o.id !== "injected"))).map((c) => (
            <button role="menuitem" key={c.uid} type="button" className="btn sm" onClick={() => { connect({ connector: c, chainId: activeChain.id }); setOpen(false); }}>
              {c.name === "Injected" ? "Browser wallet" : c.name}
            </button>
          ))}
          {error && <div className="small err-text">{error.message.split("\n")[0]}</div>}
          <div className="small muted">Robinhood Chain{activeChain.testnet ? " Testnet" : ""} · chain {activeChain.id}</div>
        </div>
      )}
    </div>
  );
}
