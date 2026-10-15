"use client";
// One job: what it asks, who is on it, its history, and the next step for whoever is looking — the poster decides
// and pays, the agent's holder takes, passes or submits.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount, useSignMessage, useWriteContract } from "wagmi";
import { parseUnits, erc20Abi, type Address } from "viem";
import { ConnectButton } from "@/components/ConnectButton";
import { contract } from "@/lib/contracts";
import { explorerUrl } from "@/lib/chains";
import { board, comd, ago, STATUS_LABEL, type BoardJob } from "@/lib/board";
import { useCollection, heldBy } from "@/lib/useAgents";
import { Face } from "./Board";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function JobView({ id }: { id: string }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const col = useCollection();
  const held = heldBy(col, address);
  const [j, setJ] = useState<BoardJob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [as, setAs] = useState<number | null>(null);
  const [sub, setSub] = useState({ text: "", url: "", coin: "" });
  const [note, setNote] = useState("");

  useEffect(() => { board.job(id).then(setJ).catch((e) => setErr((e as Error).message)); }, [id]);
  useEffect(() => { if (held.length && as == null) setAs(held[0]); }, [held.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err && !j) return <div className="jb-empty"><b>No such job.</b><span>{err}</span></div>;
  if (!j) return <p className="muted">Loading…</p>;

  const me = address?.toLowerCase();
  const isPoster = !!me && j.poster.wallet === me;
  const holdsWorker = !!j.agent && held.includes(Number(j.agent));
  const canTake = j.status === "open" && held.length > 0 && !isPoster;

  async function run(path: string, body: Record<string, unknown>) {
    if (!address) return;
    setBusy(true); setErr(null);
    try { setJ(await board.act<BoardJob>(address, (m) => signMessageAsync({ message: m }), path, body)); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function pay() {
    const token = contract("ComdToken").address as Address | undefined;
    if (!token || !j?.payment || !address) { setErr("The $COMD contract is not configured here."); return; }
    setBusy(true); setErr(null);
    try {
      const tx = await writeContractAsync({ address: token, abi: erc20Abi, functionName: "transfer", args: [j.payment.to as Address, parseUnits(j.payment.amount, 18)] });
      setJ(await board.act<BoardJob>(address, (m) => signMessageAsync({ message: m }), `/jobs/${j.id}/paid`, { tx }));
    } catch (e) { setErr((e as Error).message.split("\n")[0]); } finally { setBusy(false); }
  }

  return (
    <div className="jv">
      <div className="jv-main">
        <div className="jb-job-top">
          <span className={`jb-st s-${j.status}`}>{STATUS_LABEL[j.status]}</span>
          {j.kind === "launch" && <span className="jb-tag gold">Coin launch</span>}
          {j.offeredTo && <span className="jb-tag cyan">Offered to agent #{j.offeredTo}</span>}
          <span className="jb-age">posted {ago(j.createdAt)}</span>
        </div>
        <h1 className="jv-title">{j.title}</h1>
        <div className="jv-reward"><b>{comd(j.reward)}</b> $COMD</div>
        {j.body && <p className="jv-body">{j.body}</p>}

        {j.launch && (
          <dl className="jv-launch">
            <dt>Coin</dt><dd>{j.launch.name} · <b>${j.launch.symbol}</b></dd>
            {j.launch.website && <><dt>Website</dt><dd><a href={j.launch.website} target="_blank" rel="noreferrer nofollow">{j.launch.website}</a></dd></>}
            {j.launch.logo && <><dt>Logo</dt><dd><a href={j.launch.logo} target="_blank" rel="noreferrer nofollow">link</a></dd></>}
            <dt>Where</dt><dd><Link href="/incorporations">Incorporations</Link>: a curve priced in $COMD that graduates at 400k $COMD.</dd>
          </dl>
        )}

        {j.submission && (
          <div className="jv-sub">
            <span className="ld-eyebrow c-cyan">Handed in {ago(j.submission.at)}</span>
            <p>{j.submission.text}</p>
            {j.submission.url && <a href={j.submission.url} target="_blank" rel="noreferrer nofollow">{j.submission.url}</a>}
            {j.submission.coin && <Link href={`/incorporations/${j.submission.coin}`}>The coin: {short(j.submission.coin)} ›</Link>}
          </div>
        )}

        <ol className="jv-log">
          {[...j.events].reverse().map((e, i) => (
            <li key={i}><b>{e.what}</b> <span>{e.by.startsWith("agent") ? e.by : short(e.by)} · {ago(e.at)}</span>{e.note && <em>“{e.note}”</em>}</li>
          ))}
        </ol>
      </div>

      <aside className="jv-side">
        <div className="jb-panel">
          <div className="jv-people">
            <div><span>Posted by</span>{j.poster.agent ? <Link href={`/agents/${j.poster.agent}`}><Face id={j.poster.agent} /> Agent #{j.poster.agent}</Link> : <b>{short(j.poster.wallet)}</b>}</div>
            <div><span>Agent</span>{j.agent ? <Link href={`/agents/${j.agent}`}><Face id={j.agent} /> Agent #{j.agent}</Link> : <b className="muted">nobody yet</b>}</div>
          </div>
        </div>

        <div className="jb-panel">
          {!address ? (
            <div className="jb-connect"><p>Connect a wallet to act on this job: as its poster, or for an agent you hold.</p><ConnectButton className="btn primary" label="Connect a wallet" /></div>
          ) : (
            <div className="jv-acts">
              {/* the agent's side */}
              {canTake && (
                <>
                  <b>Take it for an agent</b>
                  <select value={as ?? ""} onChange={(e) => setAs(Number(e.target.value))}>{held.slice(0, 50).map((id) => <option key={id} value={id}>Agent #{id}</option>)}</select>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn primary" disabled={busy || !as || (!!j.offeredTo && j.offeredTo !== String(as))} onClick={() => run(`/jobs/${j.id}/take`, { agent: as })}>Take the job</button>
                    <button className="btn" disabled={busy || !as} onClick={() => run(`/jobs/${j.id}/pass`, { agent: as })}>Pass</button>
                  </div>
                  {j.offeredTo && j.offeredTo !== String(as) && <span className="small muted">Offered to agent #{j.offeredTo} only.</span>}
                </>
              )}
              {holdsWorker && j.status === "taken" && (
                <>
                  <b>Hand in the work for agent #{j.agent}</b>
                  <textarea rows={4} value={sub.text} onChange={(e) => setSub({ ...sub, text: e.target.value })} placeholder="What was done." />
                  <input value={sub.url} onChange={(e) => setSub({ ...sub, url: e.target.value })} placeholder="https:// link to the result (optional)" />
                  {j.kind === "launch" && <input value={sub.coin} onChange={(e) => setSub({ ...sub, coin: e.target.value.trim() })} placeholder="0x… address of the coin launched" />}
                  <button className="btn primary" disabled={busy || !sub.text.trim() || (j.kind === "launch" && !/^0x[0-9a-fA-F]{40}$/.test(sub.coin))} onClick={() => run(`/jobs/${j.id}/submit`, { agent: Number(j.agent), text: sub.text, url: sub.url || undefined, coin: sub.coin || undefined })}>Submit</button>
                  {j.kind === "launch" && <Link className="small" href="/incorporations">Launch the coin on Incorporations ›</Link>}
                </>
              )}
              {/* the poster's side */}
              {isPoster && j.status === "submitted" && (
                <>
                  <b>Your decision</b>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note for the agent (optional)" />
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn primary" disabled={busy} onClick={() => run(`/jobs/${j.id}/decide`, { decision: "approve", note: note || undefined })}>Approve</button>
                    <button className="btn" disabled={busy} onClick={() => run(`/jobs/${j.id}/decide`, { decision: "revise", note: note || undefined })}>Send back</button>
                  </div>
                </>
              )}
              {isPoster && (j.status === "taken" || j.status === "submitted") && <button className="btn ghost sm" disabled={busy} onClick={() => run(`/jobs/${j.id}/decide`, { decision: "release" })}>Release it to the board</button>}
              {isPoster && j.status === "open" && <button className="btn ghost sm" disabled={busy} onClick={() => run(`/jobs/${j.id}/decide`, { decision: "cancel" })}>Cancel the job</button>}
              {j.status === "done" && j.payment && (
                j.payment.tx ? (
                  <p className="jv-paid">Paid {comd(j.payment.amount)} $COMD to {short(j.payment.to)}. <a href={explorerUrl("tx", j.payment.tx)} target="_blank" rel="noreferrer">Transaction ›</a></p>
                ) : isPoster ? (
                  <><b>Pay the agent</b><p className="small muted">{comd(j.payment.amount)} $COMD to the agent&apos;s holder, {short(j.payment.to)}.</p><button className="btn primary" disabled={busy} onClick={pay}>{busy ? "Check your wallet…" : `Pay ${comd(j.payment.amount)} $COMD`}</button></>
                ) : <p className="small muted">Approved. Waiting for the poster to pay {comd(j.payment.amount)} $COMD.</p>
              )}
              {!canTake && !holdsWorker && !isPoster && j.status !== "done" && <p className="small muted">Nothing for this wallet to do on this job.</p>}
            </div>
          )}
          {err && <p className="err-text small">{err}</p>}
        </div>
      </aside>
    </div>
  );
}
