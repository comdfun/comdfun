"use client";
// The Holders Room. Connect, sign once to prove the wallet is yours, and the room opens if it holds a Counsel or any
// $COMD. Two halves: the chat, and the promotion board where a submission is reviewed and an accepted one accrues
// $COMD. Admin wallets get review, removal and the payout ledger in the same page.
//
// The session token lives in sessionStorage, not localStorage: it dies with the tab, and it is only a room pass —
// it can post a message and submit a link, nothing on chain.
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";

type Standing = { address: string; counsel: number; comd: string; mayEnter: boolean; admin: boolean };
type Message = { id: string; at: string; address: string; text: string; admin: boolean };
type Promo = {
  id: string; createdAt: string; address: string; url: string; kind: string; note: string;
  status: "pending" | "accepted" | "rejected"; reason?: string; rewardComd?: string; paidAt?: string; payoutTx?: string;
};
type Owed = { address: string; accepted: number; comd: string; oldest: string };

const KEY = "comd.room.token";
const KINDS = ["post", "thesis", "video", "article", "other"] as const;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const comd = (wei: string) => { try { return (BigInt(wei) / 10n ** 18n).toLocaleString(); } catch { return "0"; } };
/** Rewards are counted in whole $COMD, not wei — the ledger stores them that way. */
const whole = (n: string | undefined) => { try { return BigInt(n ?? "0").toLocaleString(); } catch { return "0"; } };
const when = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function readToken(): string | null {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}
function writeToken(t: string | null) {
  try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch { /* private window */ }
}

async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  const res = await fetch(`/api/room${path}`, {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) throw new Error(data?.detail || data?.error || `the room is not answering (${res.status})`);
  return data as T;
}

export function HoldersRoom() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Standing | null>(null);
  const [standing, setStanding] = useState<Standing | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "promo">("chat");

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [promos, setPromos] = useState<Promo[]>([]);
  const [reward, setReward] = useState("0");
  const [owed, setOwed] = useState<Owed[]>([]);
  const [form, setForm] = useState({ url: "", kind: "post", note: "" });
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => { setToken(readToken()); }, []);

  // What the chain says about the connected wallet, before any signing.
  useEffect(() => {
    let off = false;
    if (!address) { setStanding(null); return; }
    api<Standing>(`/standing/${address}`).then((s) => { if (!off) setStanding(s); }).catch(() => { if (!off) setStanding(null); });
    return () => { off = true; };
  }, [address]);

  const loadAll = useCallback(async (t: string | null) => {
    const [m, p] = await Promise.all([
      api<{ messages: Message[] }>("/messages").catch(() => ({ messages: [] as Message[] })),
      api<{ promos: Promo[]; rewardComd: string }>("/promos", { token: t }).catch(() => ({ promos: [] as Promo[], rewardComd: "0" })),
    ]);
    setMessages(m.messages);
    setPromos(p.promos);
    setReward(p.rewardComd);
  }, []);

  // Sign in with the token we already hold, or drop it if the room no longer accepts it.
  useEffect(() => {
    if (!token) { setMe(null); return; }
    let off = false;
    api<Standing>("/me", { token })
      .then((s) => { if (!off) { setMe(s); loadAll(token); } })
      .catch(() => { if (!off) { writeToken(null); setToken(null); setMe(null); } });
    return () => { off = true; };
  }, [token, loadAll]);

  // The chat polls while the tab is open and visible.
  useEffect(() => {
    if (!me || tab !== "chat") return;
    const tick = () => { if (!document.hidden) api<{ messages: Message[] }>("/messages").then((m) => setMessages(m.messages)).catch(() => {}); };
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [me, tab]);

  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages.length, tab]);

  useEffect(() => {
    if (!me?.admin || !token) return;
    api<{ owed: Owed[] }>("/payouts", { token }).then((r) => setOwed(r.owed)).catch(() => {});
  }, [me?.admin, token, promos.length]);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const signIn = () => guard(async () => {
    if (!address) return;
    const { message } = await api<{ nonce: string; message: string }>("/nonce", { method: "POST", body: { address } });
    const signature = await signMessageAsync({ message });
    const out = await api<{ token: string; standing: Standing }>("/session", { method: "POST", body: { address, signature } });
    writeToken(out.token);
    setToken(out.token);
    setMe(out.standing);
    await loadAll(out.token);
  });

  const leave = () => { writeToken(null); setToken(null); setMe(null); setMessages([]); setPromos([]); };

  const say = () => guard(async () => {
    const text = draft.trim();
    if (!text) return;
    await api("/messages", { method: "POST", body: { text }, token });
    setDraft("");
    const m = await api<{ messages: Message[] }>("/messages");
    setMessages(m.messages);
  });

  const submit = () => guard(async () => {
    await api("/promos", { method: "POST", body: form, token });
    setForm({ url: "", kind: "post", note: "" });
    await loadAll(token);
  });

  const review = (id: string, decision: "accept" | "reject") => guard(async () => {
    const reason = decision === "reject" ? (prompt("Why is it rejected? (optional, the author sees this)") ?? "") : "";
    await api(`/promos/${id}/review`, { method: "POST", body: { decision, reason }, token });
    await loadAll(token);
  });

  const removeWallet = (addr: string) => guard(async () => {
    if (!confirm(`Remove ${short(addr)} from the room?\n\nTheir messages and pending submissions are deleted and they cannot sign in again. Anything already accepted and unpaid stays owed to them.`)) return;
    const reason = prompt("Reason (kept on the record)") ?? "";
    await api(`/members/${addr}/remove`, { method: "POST", body: { reason }, token });
    await loadAll(token);
  });

  const markPaid = (addr: string) => guard(async () => {
    const txHash = prompt(`Paid ${short(addr)}? Paste the transaction hash (optional)`) ?? "";
    await api(`/payouts/${addr}/paid`, { method: "POST", body: { txHash: txHash.trim() }, token });
    await loadAll(token);
    const r = await api<{ owed: Owed[] }>("/payouts", { token });
    setOwed(r.owed);
  });

  // ---------------------------------------------------------------- the door

  if (!isConnected) {
    return (
      <div className="panel c-pink rv stack" style={{ gap: 14 }}>
        <h3 style={{ margin: 0 }}>Connect to come in</h3>
        <p className="muted" style={{ margin: 0 }}>The room is open to any wallet holding a <strong>Counsel</strong> or any <strong>$COMD</strong>. Connecting shows you where you stand; one signature opens the door.</p>
        <ConnectButton className="btn primary" label="Connect wallet" />
      </div>
    );
  }

  if (!me) {
    const can = standing?.mayEnter ?? false;
    return (
      <div className="panel c-pink rv stack" style={{ gap: 14 }}>
        <h3 style={{ margin: 0 }}>{can ? "Sign to come in" : "This wallet does not hold yet"}</h3>
        <dl className="kv">
          <dt>Wallet</dt><dd className="mono">{address ? short(address) : "—"}</dd>
          <dt>Counsel</dt><dd>{standing ? standing.counsel : "…"}</dd>
          <dt>$COMD</dt><dd>{standing ? comd(standing.comd) : "…"}</dd>
        </dl>
        {can ? (
          <>
            <p className="muted small" style={{ margin: 0 }}>One signature, no transaction and no gas. It proves the wallet is yours; it cannot move anything.</p>
            <button type="button" className="btn primary" onClick={signIn} disabled={busy}>{busy ? "Check your wallet…" : "Sign in to the room"}</button>
          </>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>Hold a Counsel or any $COMD and the door opens. <a href="/mint">Counsel</a> · <a href="/swap">$COMD</a></p>
        )}
        {err && <p className="err-text small" style={{ margin: 0 }}>{err}</p>}
      </div>
    );
  }

  // ---------------------------------------------------------------- inside

  const mine = (a: string) => a.toLowerCase() === (me.address ?? "").toLowerCase();
  const pending = promos.filter((p) => p.status === "pending");

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="badge ok">In the room</span>
          <span className="badge">{me.counsel} Counsel</span>
          <span className="badge">{comd(me.comd)} $COMD</span>
          {me.admin && <span className="badge pink fill">Admin</span>}
        </div>
        <button type="button" className="btn sm" onClick={leave}>Leave</button>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button type="button" className={`btn sm ${tab === "chat" ? "primary" : ""}`} onClick={() => setTab("chat")}>Chat</button>
        <button type="button" className={`btn sm ${tab === "promo" ? "primary" : ""}`} onClick={() => setTab("promo")}>
          Promotion{pending.length && me.admin ? ` · ${pending.length} to review` : ""}
        </button>
      </div>

      {err && <p className="err-text small" style={{ margin: 0 }}>{err}</p>}

      {tab === "chat" ? (
        <div className="panel c-cyan rv stack" style={{ gap: 12 }}>
          <div ref={log} className="room-log">
            {messages.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing said yet. Say the first thing.</p>}
            {messages.map((m) => (
              <div key={m.id} className={`room-msg${mine(m.address) ? " mine" : ""}`}>
                <div className="room-msg-head">
                  <span className="mono">{short(m.address)}</span>
                  {m.admin && <span className="badge pink">team</span>}
                  <span className="muted">{when(m.at)}</span>
                  {(mine(m.address) || me.admin) && (
                    <button type="button" className="linklike small" onClick={() => guard(async () => { await api(`/messages/${m.id}/delete`, { method: "POST", token }); setMessages((xs) => xs.filter((x) => x.id !== m.id)); })}>delete</button>
                  )}
                  {me.admin && !mine(m.address) && (
                    <button type="button" className="linklike small err-text" onClick={() => removeWallet(m.address)}>remove wallet</button>
                  )}
                </div>
                <p>{m.text}</p>
              </div>
            ))}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <input
              value={draft}
              maxLength={500}
              placeholder="Say something to the room"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); say(); } }}
              style={{ flex: 1 }}
            />
            <button type="button" className="btn primary" onClick={say} disabled={busy || !draft.trim()}>Send</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>Everyone in the room sees this, and the team can remove anything. Never paste a seed phrase or a private key — nobody here will ask for one.</p>
        </div>
      ) : (
        <div className="stack" style={{ gap: 18 }}>
          <div className="panel c-gold rv stack" style={{ gap: 12 }}>
            <h3 style={{ margin: 0 }}>Submit something you posted</h3>
            <p className="muted small" style={{ margin: 0 }}>A thesis, a thread, a video — anything you published about Company.md. The team reads every one, and an accepted submission accrues <strong>{whole(reward)} $COMD</strong>, paid out in batches.</p>
            <input value={form.url} placeholder="https://x.com/you/status/…" onChange={(e) => setForm({ ...form, url: e.target.value })} />
            <div className="row" style={{ gap: 8 }}>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <input value={form.note} maxLength={280} placeholder="Anything we should know (optional)" onChange={(e) => setForm({ ...form, note: e.target.value })} style={{ flex: 1 }} />
            </div>
            <button type="button" className="btn primary" onClick={submit} disabled={busy || !form.url.trim()}>Submit</button>
          </div>

          {me.admin && owed.length > 0 && (
            <div className="panel c-lime rv stack" style={{ gap: 10 }}>
              <h3 style={{ margin: 0 }}>Owed · pay these in a batch</h3>
              <table className="table">
                <thead><tr><th>Wallet</th><th>Accepted</th><th>$COMD</th><th /></tr></thead>
                <tbody>
                  {owed.map((o) => (
                    <tr key={o.address}>
                      <td className="mono">{short(o.address)}</td>
                      <td>{o.accepted}</td>
                      <td>{whole(o.comd)}</td>
                      <td><button type="button" className="btn sm" onClick={() => markPaid(o.address)} disabled={busy}>Mark paid</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small" style={{ margin: 0 }}>The room never sends funds. Pay from your own wallet, then mark it paid here.</p>
            </div>
          )}

          <div className="stack" style={{ gap: 10 }}>
            {promos.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing submitted yet.</p>}
            {promos.map((p) => (
              <div key={p.id} className={`folder rv c-${p.status === "accepted" ? "lime" : p.status === "rejected" ? "crimson" : "gold"}`} data-tab={p.status}>
                <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <a href={p.url} target="_blank" rel="noopener noreferrer nofollow ugc" className="mono">{p.url.slice(0, 70)}</a>
                  <span className="muted small">{p.kind} · <span className="mono">{short(p.address)}</span></span>
                </div>
                {p.note && <p className="small" style={{ margin: "6px 0 0" }}>{p.note}</p>}
                {p.reason && <p className="muted small" style={{ margin: "6px 0 0" }}>Note from the team: {p.reason}</p>}
                {p.status === "accepted" && (
                  <p className="small ok" style={{ margin: "6px 0 0" }}>
                    Accepted · {whole(p.rewardComd)} $COMD {p.paidAt ? "· paid" : "· awaiting payout"}
                  </p>
                )}
                {me.admin && p.status === "pending" && (
                  <div className="row" style={{ gap: 8, marginTop: 8 }}>
                    <button type="button" className="btn sm primary" onClick={() => review(p.id, "accept")} disabled={busy}>Accept</button>
                    <button type="button" className="btn sm" onClick={() => review(p.id, "reject")} disabled={busy}>Reject</button>
                    <button type="button" className="btn sm" onClick={() => removeWallet(p.address)} disabled={busy}>Remove wallet</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
