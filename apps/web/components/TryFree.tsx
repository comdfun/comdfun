"use client";
// One free matter. Connect, sign once to prove the wallet, ask a question, and the answer is filed on the public
// docket like any other matter. No payment, no approval, no gas: the point is to see what the firm produces before
// deciding whether to pay for it.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useSignMessage } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";

type Status = {
  enabled: boolean;
  skill: string;
  remainingToday: number;
  perDay: number;
  used: { jobId: string; at: string } | null;
};

const EXAMPLES = [
  "What are the tradeoffs of optimistic versus zk rollups for a payments app?",
  "Compare the fee models of the three largest L2s, with sources.",
  "What happened to on-chain perpetuals volume over the last year, and why?",
];

async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/trial${path}`, {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const problems = data?.problems?.map((p: { message?: string }) => p.message).filter(Boolean).join("; ");
    throw new Error(problems || data?.detail || data?.error || `that did not go through (${res.status})`);
  }
  return data as T;
}

export function TryFree() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [status, setStatus] = useState<Status | null>(null);
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ jobId: string } | null>(null);

  const load = useCallback(() => {
    api<Status>(address ? `?address=${address}` : "").then(setStatus).catch(() => setStatus(null));
  }, [address]);
  useEffect(load, [load]);

  const go = async () => {
    setBusy(true); setErr(null);
    try {
      if (!address) return;
      const { message } = await api<{ nonce: string; message: string }>("/nonce", { method: "POST", body: { address } });
      const signature = await signMessageAsync({ message });
      const out = await api<{ jobId: string }>("/claim", { method: "POST", body: { address, signature, objective: objective.trim() } });
      setDone(out);
      load();
    } catch (e) {
      const m = (e as Error).message;
      setErr(/denied|rejected|User rejected/i.test(m) ? "Signature cancelled, so nothing was filed. Your free matter is still unused." : m);
    } finally { setBusy(false); }
  };

  if (status && !status.enabled) {
    return (
      <div className="panel c-violet stack" style={{ gap: 12 }}>
        <h3 style={{ margin: 0 }}>Free matters are closed right now</h3>
        <p className="muted" style={{ margin: 0 }}>They open in batches. In the meantime you can read everything the firm has filed, or retain it properly.</p>
        <div className="row" style={{ gap: 8 }}>
          <Link href="/published" className="btn sm">See what it files</Link>
          <Link href="/launch" className="btn sm primary">Retain the firm</Link>
        </div>
      </div>
    );
  }

  if (done || status?.used) {
    const jobId = done?.jobId ?? status!.used!.jobId;
    return (
      <div className="panel c-lime stack" style={{ gap: 12 }}>
        <h3 style={{ margin: 0 }}>{done ? "Filed. It is on the docket now." : "You have had your free matter"}</h3>
        <p className="muted" style={{ margin: 0 }}>
          {done
            ? "A Counsel will pick it up, draft it, and have it cross-examined before anything is filed. Nothing else is needed from you; follow it here."
            : "One per wallet. Retaining the firm costs 100 $COMD a matter, and the work is the same."}
        </p>
        <div className="row" style={{ gap: 8 }}>
          <Link href={`/jobs/${jobId}`} className="btn sm primary">Follow the matter</Link>
          <Link href="/launch" className="btn sm">Retain the firm</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="panel c-gold stack" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Ask the firm one question, free</h3>
        {status && <span className="small muted">{status.remainingToday} of {status.perDay} left today</span>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        One per wallet. A Counsel researches it and files a cited report on the public docket, exactly as it would for a
        paying client. No payment, no approval, no gas: one signature to prove the wallet is yours.
      </p>

      <textarea
        rows={3}
        maxLength={1000}
        value={objective}
        placeholder="What do you want researched?"
        onChange={(e) => setObjective(e.target.value)}
      />
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {EXAMPLES.map((x) => (
          <button key={x} type="button" className="btn sm" onClick={() => setObjective(x)}>{x.slice(0, 42)}…</button>
        ))}
      </div>

      {isConnected ? (
        <button type="button" className="btn primary" onClick={go} disabled={busy || objective.trim().length < 12 || status?.remainingToday === 0}>
          {busy ? "Check your wallet…" : status?.remainingToday === 0 ? "Today's free matters are spent" : "Sign and file it"}
        </button>
      ) : (
        <ConnectButton className="btn primary" label="Connect a wallet to file it" />
      )}
      {err && <p className="err-text small" style={{ margin: 0 }}>{err}</p>}
      <p className="muted small" style={{ margin: 0 }}>
        It goes through the same checks as a paid matter, so a question that could not be answered properly is turned
        away before a Counsel starts rather than failing later.
      </p>
    </div>
  );
}
