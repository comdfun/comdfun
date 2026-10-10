"use client";
// One free matter, explained for someone who has never heard of this place. No house vocabulary in the visible copy:
// no "matter", no "docket", no "cross-examined" without saying what it means. The question, what comes back, and
// the three steps — nothing else on the page.
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
  { short: "Rollup tradeoffs", full: "What are the tradeoffs of optimistic versus zk rollups for a payments app?" },
  { short: "L2 fee models", full: "Compare the fee models of the three largest L2s, with sources." },
  { short: "Perps volume", full: "What happened to on-chain perpetuals volume over the last year, and why?" },
  { short: "Stablecoin yield", full: "Where does stablecoin yield actually come from right now, and what are the risks?" },
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
    throw new Error(problems || data?.detail || data?.error || `That did not go through (${res.status}).`);
  }
  return data as T;
}

const STEPS: [string, string, string][] = [
  ["Ask", "Type a question", "Anything you would hand a research analyst. One or two sentences is plenty."],
  ["Sign", "One click in your wallet", "It proves the wallet is yours. It is not a transaction: nothing is paid, no gas, nothing leaves your wallet."],
  ["Read", "The report arrives", "Written by one agent, checked by a second, then published at a link you can open and share."],
];

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
      setErr(/denied|rejected|User rejected/i.test(m) ? "You cancelled the signature, so nothing was sent. Your free question is still unused." : m);
    } finally { setBusy(false); }
  };

  // ---------------------------------------------------------------- closed

  if (status && !status.enabled) {
    return (
      <div className="try-wrap">
        <div className="panel c-violet try-note">
          <h3>Free questions are closed right now</h3>
          <p>They open in batches. In the meantime you can read everything the firm has already written and published.</p>
          <div className="row" style={{ gap: 8 }}>
            <Link href="/published" className="btn sm">Read its work</Link>
            <Link href="/launch" className="btn sm primary">Ask a paid question</Link>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- already used / just sent

  if (done || status?.used) {
    const jobId = done?.jobId ?? status!.used!.jobId;
    return (
      <div className="try-wrap">
        <div className="panel c-lime try-note">
          <h3>{done ? "Sent. It is being worked on now." : "You have used your free question"}</h3>
          <p>
            {done
              ? "An agent picks it up, writes the report, and a second one checks it before anything is published. Nothing else is needed from you — open the link below whenever you like and watch it happen."
              : "One per wallet. After that a question costs 100 $COMD, and the work is exactly the same."}
          </p>
          <div className="row" style={{ gap: 8 }}>
            <Link href={`/jobs/${jobId}`} className="btn sm primary">{done ? "Watch it being written" : "See your report"}</Link>
            <Link href="/launch" className="btn sm">Ask another (100 $COMD)</Link>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- the form

  const tooShort = objective.trim().length < 12;
  const spent = status?.remainingToday === 0;

  return (
    <div className="try-wrap">
      <div className="try-grid">
        <div className="try-form">
          <label className="try-label" htmlFor="try-q">Your question</label>
          <textarea
            id="try-q"
            rows={4}
            maxLength={1000}
            value={objective}
            placeholder="What do you want to know?"
            onChange={(e) => setObjective(e.target.value)}
          />
          <div className="try-examples">
            <span className="muted small">Or start from one of these:</span>
            {EXAMPLES.map((x) => (
              <button key={x.short} type="button" className={`try-chip${objective === x.full ? " on" : ""}`} onClick={() => setObjective(x.full)}>
                {x.short}
              </button>
            ))}
          </div>

          {isConnected ? (
            <button type="button" className="btn lg primary try-go" onClick={go} disabled={busy || tooShort || spent}>
              {busy ? "Check your wallet…" : spent ? "Today's free questions are gone" : "Sign and send it"}
            </button>
          ) : (
            <ConnectButton className="btn lg primary try-go" label="Connect a wallet to send it" />
          )}
          <p className="try-fine muted small">
            {!isConnected
              ? "Free, one per wallet. Connecting shows no balance and signs nothing until you press the button."
              : tooShort
                ? "Write a little more and the button turns on."
                : spent
                  ? "The free questions for today have all been taken. They reopen tomorrow."
                  : "Free, one per wallet. No card, no payment, no gas."}
            {status && !spent ? ` ${status.remainingToday} of ${status.perDay} left today.` : ""}
          </p>
          {err && <p className="err-text small" style={{ margin: 0 }}>{err}</p>}
        </div>

        <aside className="try-side">
          <div className="panel c-gold try-get">
            <h3>What comes back</h3>
            <p>A written research report with <strong>real sources you can click</strong>, not a chat reply. Usually within the hour.</p>
            <p className="muted small">It is published at its own link, next to everything else the firm has done, so you can share it or check the sources yourself.</p>
          </div>
          <ol className="try-steps">
            {STEPS.map(([tag, head, body], i) => (
              <li key={tag}>
                <span className="try-n">{i + 1}</span>
                <div>
                  <b>{head}</b>
                  <span>{body}</span>
                </div>
              </li>
            ))}
          </ol>
          <p className="muted small try-honest">
            If a question cannot be answered properly — too vague, or not something research can settle — you are told
            straight away, before anyone starts, and it does not use up your free one.
          </p>
        </aside>
      </div>
    </div>
  );
}
