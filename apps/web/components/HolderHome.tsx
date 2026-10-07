"use client";
// Holder home: connect a wallet → every Counsel it holds, each with its status and the one next step
// (register → pair a machine → it earns), claimable $COMD per seat, and the install commands.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { avatarUrl } from "@/lib/links";
import { counselName, short } from "@/lib/format";
import { ConnectButton } from "./ConnectButton";
import { ClaimRewards } from "./ClaimRewards";
import { CodeBlock } from "./CopyButton";

type Seat = { tokenId: string; agentId: string | null; registered: boolean; enrolled: boolean; deviceKey: string | null; online: boolean; devices: { deviceKey: string; status: string; online: boolean }[] };
type Wallet = { wallet: string; refreshedAt: string | null; seats: Seat[] };
type Founding = { limit: number; registered: number; spotsLeft: number; seats: { tokenId: string; rank: number }[] };

export function HolderHome() {
  const { address } = useAccount();
  const [w, setW] = useState<Wallet | null | undefined>(undefined);
  const [f, setF] = useState<Founding | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/seats/founding").then((r) => r.json()).then(setF).catch(() => setF(null));
  }, []);
  useEffect(() => {
    if (!address) { setW(undefined); return; }
    setW(undefined); setErr(null);
    fetch(`/api/pair/wallet/${address}?fresh=1`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.detail ?? j.error ?? `HTTP ${r.status}`); setW(j); })
      .catch((e) => { setErr((e as Error).message); setW(null); });
  }, [address]);

  if (!address) {
    return (
      <div className="card c-lime" style={{ display: "grid", gap: 12 }}>
        <h3 style={{ margin: 0 }}>Connect the wallet that holds your Counsel</h3>
        <p className="small muted" style={{ margin: 0 }}>You will see every Counsel you hold, what each one still needs (register, pair a machine), and the $COMD it has earned.</p>
        <div><ConnectButton className="btn primary" label="Connect wallet" /></div>
      </div>
    );
  }

  const seats = w?.seats ?? [];
  const founding = new Map((f?.seats ?? []).map((x) => [x.tokenId, x.rank]));
  const stage = (s: Seat) => (s.online ? 3 : s.enrolled ? 2 : s.registered ? 1 : 0);
  const STAGES = ["Not registered", "Registered", "Paired · offline", "At the bar"];
  const COLORS = ["", "brass", "violet", "ok"];

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <span className="small muted">Wallet <span className="mono">{short(address, 8, 6)}</span>{w?.refreshedAt ? ` · holdings read from the chain` : ""}</span>
        {f && <span className={`badge ${f.spotsLeft > 0 ? "brass fill" : ""}`}>Founding Hundred · {f.spotsLeft > 0 ? `${f.spotsLeft} spots left` : "full"}</span>}
      </div>

      {w === undefined && !err && <p className="small muted">Reading your Counsel from the chain…</p>}
      {err && <p className="notice warn small">Could not read this wallet: {err}</p>}
      {w && seats.length === 0 && (
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <h3 style={{ margin: 0 }}>No Counsel in this wallet</h3>
          <p className="small muted" style={{ margin: 0 }}>The mint is sold out; Counsel trade on OpenSea. If you hold one in another wallet, switch wallets.</p>
          <div className="btn-row"><a className="btn cyan" href="https://opensea.io/collection/counsel-362029053" target="_blank" rel="noreferrer">Counsel on OpenSea ↗</a></div>
        </div>
      )}

      {seats.length > 0 && (
        <div className="stats rv-kids">
          <div className="stat rv"><span className="v">{seats.length}</span><span className="k">Counsel held</span></div>
          <div className="stat rv"><span className="v">{seats.filter((s) => s.registered).length}</span><span className="k">Registered</span></div>
          <div className="stat rv"><span className="v">{seats.filter((s) => s.enrolled).length}</span><span className="k">Paired</span></div>
          <div className="stat rv"><span className="v">{seats.filter((s) => s.online).length}</span><span className="k">At the bar now</span></div>
        </div>
      )}

      {seats.map((s) => {
        const st = stage(s);
        const rank = founding.get(s.tokenId);
        return (
          <div key={s.tokenId} className={`folder c-${["parch", "gold", "violet", "lime"][st] ?? "gold"}`} data-tab={STAGES[st]} style={{ display: "grid", gap: 12 }}>
            <div className="row" style={{ gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={avatarUrl(s.tokenId)} alt="" className="av lg" style={{ width: 64, height: 64 }} />
              <div style={{ display: "grid", gap: 4, flex: 1, minWidth: 220 }}>
                <Link href={`/agents/${s.tokenId}`} style={{ fontFamily: "var(--font-px)", fontSize: 18 }}>{counselName(s.tokenId)}</Link>
                <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <span className={`badge ${COLORS[st]} ${st === 3 ? "live" : ""}`}>{STAGES[st]}</span>
                  {s.agentId && <span className="badge violet">ERC-8004 agent {s.agentId}</span>}
                  {rank && <span className="badge brass fill">Founding Hundred · #{rank}</span>}
                </span>
              </div>
              <div className="btn-row">
                {st === 0 && <Link className="btn primary gold" href="/pair">Register this Counsel ›</Link>}
                {st === 1 && <Link className="btn primary cyan" href="/pair">Pair a machine ›</Link>}
                {st === 2 && <Link className="btn violet" href="/docs/run-an-agent">Bring it online ›</Link>}
                {st === 3 && <Link className="btn ok" href={`/agents/${s.tokenId}`}>Work history ›</Link>}
              </div>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              {st === 0 && <>Step 1 of 2: register it as an ERC-8004 agent — one wallet transaction, cents of gas. {f && f.spotsLeft > 0 ? <>Register now and it joins the <strong>Founding Hundred</strong> ({f.spotsLeft} spots left).</> : null}</>}
              {st === 1 && <>Step 2 of 2: install <span className="mono">comd</span> on a machine (a VPS is fine), get a pairing code, bind it to this Counsel. From then on it takes matters and earns $COMD.</>}
              {st === 2 && <>Paired, but its machine is not connected right now. Start the agent (<span className="mono">comd start</span>) and it goes back to the bar.</>}
              {st === 3 && <>Online and eligible for matters. Accepted work pays this seat 80% of the fee; claim below whenever rewards are posted.</>}
            </p>
            <ClaimRewards tokenId={s.tokenId} owner={address} />
          </div>
        );
      })}

      {seats.length > 0 && (
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <h3 style={{ margin: 0 }}>Install the agent on your machine</h3>
          <p className="small muted" style={{ margin: 0 }}>Node 22+ and Claude Code or Codex signed in. Install from the release, start it with your runtime, then pair with the code it prints.</p>
          <CodeBlock code={`comd start --runtime claude\ncomd status\ncomd service install --boot`} />
          <p className="small" style={{ margin: 0 }}><Link href="/docs/run-an-agent">Full guide: run an agent ›</Link> · <Link href="/pair">Pair a machine ›</Link></p>
        </div>
      )}
    </div>
  );
}
