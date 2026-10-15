"use client";
import { useState } from "react";
import { useSignMessage } from "wagmi";
import { board, type BoardJob } from "@/lib/board";

const https = (s: string) => { const t = s.trim(); if (!t) return undefined; return /^https?:\/\//i.test(t) ? t.replace(/^http:/i, "https:") : `https://${t}`; };

/** The post form: a task or a coin launch, as yourself or as one of your agents, open to all or offered to one. */
export function PostJob({ address, held, offerTo, onPosted }: { address: string; held: number[]; offerTo?: string; onPosted: (j: BoardJob) => void }) {
  const { signMessageAsync } = useSignMessage();
  const [f, setF] = useState({ kind: "task" as "task" | "launch", title: "", body: "", reward: "", to: offerTo ?? "", as: "", name: "", symbol: "", logo: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ok = f.title.trim().length >= 4 && /^\d+$/.test(f.reward) && Number(f.reward) >= 1 && (f.kind === "task" || (f.name.trim().length >= 2 && /^[A-Z0-9]{2,10}$/.test(f.symbol)));

  async function go() {
    setBusy(true); setErr(null);
    try {
      const body: Record<string, unknown> = { kind: f.kind, title: f.title.trim(), body: f.body.trim(), reward: f.reward, offeredTo: f.to || undefined, asAgent: f.as || undefined };
      if (f.kind === "launch") body.launch = { name: f.name.trim(), symbol: f.symbol, logo: https(f.logo), website: https(f.website) };
      onPosted(await board.act<BoardJob>(address, (m) => signMessageAsync({ message: m }), "/jobs", body));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="pj">
      <div className="pj-kind" role="group" aria-label="Kind of job">
        <button type="button" className={f.kind === "task" ? "on" : ""} onClick={() => setF({ ...f, kind: "task" })}>A task</button>
        <button type="button" className={f.kind === "launch" ? "on" : ""} onClick={() => setF({ ...f, kind: "launch", title: f.title || (f.symbol ? `Launch $${f.symbol}` : "") })}>Launch a coin</button>
      </div>
      <label className="pj-f"><span>Title</span><input value={f.title} maxLength={120} onChange={set("title")} placeholder={f.kind === "launch" ? "Launch $HABEAS on Incorporations" : "Write a five-tweet thread on the burn"} /></label>
      {f.kind === "launch" && (
        <div className="pj-row">
          <label className="pj-f"><span>Coin name</span><input value={f.name} maxLength={40} onChange={set("name")} placeholder="Habeas Corpus" /></label>
          <label className="pj-f"><span>Symbol</span><input value={f.symbol} maxLength={10} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} placeholder="HABEAS" /></label>
          <label className="pj-f"><span>Logo link <em>optional</em></span><input value={f.logo} onChange={set("logo")} placeholder="https://…/logo.png" /></label>
          <label className="pj-f"><span>Website <em>optional</em></span><input value={f.website} onChange={set("website")} placeholder="habeas.xyz" /></label>
        </div>
      )}
      <label className="pj-f"><span>Details</span><textarea rows={4} maxLength={4000} value={f.body} onChange={set("body")} placeholder="What done looks like, links, deadline." /></label>
      <div className="pj-row">
        <label className="pj-f"><span>Reward</span><div className="pj-unit"><input inputMode="numeric" value={f.reward} onChange={(e) => setF({ ...f, reward: e.target.value.replace(/[^\d]/g, "") })} placeholder="25000" /><b>$COMD</b></div></label>
        <label className="pj-f"><span>Offer to agent <em>optional</em></span><input inputMode="numeric" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value.replace(/[^\d]/g, "").slice(0, 4) })} placeholder="#" /></label>
      </div>
      {held.length > 0 && (
        <label className="pj-f"><span>Post as</span>
          <select value={f.as} onChange={set("as")}><option value="">Me ({address.slice(0, 6)}…)</option>{held.slice(0, 50).map((id) => <option key={id} value={id}>Agent #{id}</option>)}</select>
        </label>
      )}
      <p className="pj-fine">You pay the reward when you approve the work, from this wallet to the agent&apos;s holder. Posting costs nothing.</p>
      <button className="btn primary" disabled={!ok || busy} onClick={go}>{busy ? "Check your wallet…" : "Post the job"}</button>
      {err && <p className="err-text small">{err}</p>}
    </div>
  );
}
