"use client";
// cICM: buy AI inference with $COMD.
//
// Three things in one page, in the order somebody actually needs them: what it is and what it costs, how to put
// credit on an account, and the keys. Nothing here uses `rv`: those panels mount on a state change, long after
// the reveal observer has run, and they would never be made visible.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useSignMessage } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { CopyButton } from "@/components/CopyButton";

type Rate = {
  enabled: boolean;
  reason: string | null;
  endpoint: string;
  rate: { tokensPerUsd: string; symbol: string; marginBps: number };
  deposit: { address: string | null; paymentIsBurn?: boolean; minimumTokens?: string; note: string; chainId?: number };
};
type Key = { id: string; display: string; label: string | null; disabled: boolean; createdAt: string; lastUsedAt: string | null; spentMicroUsd: string; spendLimitMicroUsd: string | null; models: string[] };
type Charge = { id: string; at: string; model: string; state: string; costMicroUsd: string; tokensIn: number; tokensOut: number };
type Deposit = { id: string; createdAt: string; tokenUnits: string; creditedMicroUsd: string; burnTx: string | null; ref: string };
type AccountView = {
  account: { id: string; owner: string; balanceMicroUsd: string; heldMicroUsd: string; depositedMicroUsd: string; spentMicroUsd: string; suspended: boolean };
  keys: Key[];
  deposits: Deposit[];
  charges: Charge[];
};

/** Micro-dollars to a dollar string. Truncates, like the ledger: nobody is shown money they do not have. */
const usd = (micro: string | undefined) => {
  try {
    const v = BigInt(micro ?? "0");
    const neg = v < 0n;
    const a = neg ? -v : v;
    return `${neg ? "-" : ""}${a / 1_000_000n}.${(a % 1_000_000n).toString().padStart(6, "0")}`;
  } catch { return "0.000000"; }
};
/** Whole tokens from base units, for a deposit row. */
const tokens = (units: string) => { try { return (BigInt(units) / 10n ** 18n).toLocaleString(); } catch { return "0"; } };
const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/icm${path}`, {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  const d = data as { detail?: string; error?: string | { message?: string } } | null;
  if (!res.ok) {
    const msg = typeof d?.error === "object" ? d.error.message : d?.error;
    throw new Error(d?.detail || msg || `cICM is not answering (${res.status}).`);
  }
  return data as T;
}

export function Icm() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [rate, setRate] = useState<Rate | null>(null);
  const [view, setView] = useState<AccountView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ secret: string; label: string | null } | null>(null);
  const [label, setLabel] = useState("");
  const [limit, setLimit] = useState("");

  useEffect(() => { api<Rate>("").then(setRate).catch(() => setRate(null)); }, []);
  // The account view is behind a signature, so it is not loaded until asked for. Opening the page signs nothing.
  useEffect(() => { setView(null); setFresh(null); }, [address]);

  /** Ask for a nonce, sign it, and post the proof with whatever else the call needs. */
  const proved = useCallback(async (extra: Record<string, unknown> = {}) => {
    if (!address) throw new Error("connect a wallet first");
    const { message } = await api<{ nonce: string; message: string }>("/nonce", { method: "POST", body: { address } });
    const signature = await signMessageAsync({ message });
    return { address, signature, ...extra };
  }, [address, signMessageAsync]);

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what); setErr(null);
    try { await fn(); }
    catch (e) {
      const m = (e as Error).message;
      setErr(/denied|rejected|User rejected/i.test(m) ? "You cancelled the signature, so nothing happened." : m);
    }
    finally { setBusy(null); }
  };

  const load = () => run("load", async () => { setView(await api<AccountView>("/account", { method: "POST", body: await proved() })); });

  const mint = () => run("mint", async () => {
    const out = await api<{ secret: string; key: Key }>("/keys", {
      method: "POST",
      body: await proved({ label: label.trim() || undefined, spendLimitUsd: limit.trim() || undefined }),
    });
    setFresh({ secret: out.secret, label: out.key.label });
    setLabel(""); setLimit("");
    setView(await api<AccountView>("/account", { method: "POST", body: await proved() }));
  });

  const revoke = (id: string) => run(`revoke:${id}`, async () => {
    await api(`/keys/${id}/revoke`, { method: "POST", body: await proved() });
    setView(await api<AccountView>("/account", { method: "POST", body: await proved() }));
  });

  const endpoint = rate?.endpoint ?? "https://api.comd.fun/icm/v1";
  const balance = view ? BigInt(view.account.balanceMicroUsd) : 0n;

  return (
    <div className="icm">
      {/* ------------------------------------------------------------------ what it is */}
      <div className="icm-top">
        <div className="panel c-gold icm-what">
          <h3>What this is</h3>
          <p>
            An OpenAI-compatible endpoint you pay for in <strong>$COMD</strong>. Point any client or agent at it with a
            cICM key and it reaches the frontier models, Claude, GPT, Gemini, Llama and the rest, with no card,
            no account with a model provider, and no monthly anything.
          </p>
          <p className="muted small">
            You are charged exactly what the model provider charged, plus {rate ? `${(rate.rate.marginBps / 100).toFixed(rate.rate.marginBps % 100 === 0 ? 0 : 2)}%` : "a published margin"}.
            Every call records what it cost, and you can read your own ledger below.
          </p>
          {rate && !rate.enabled && (
            <p className="err-text small" style={{ margin: 0 }}>
              Routing is not switched on yet. You can still buy credit and make keys; calls will start working without
              anything further from you.
            </p>
          )}
        </div>

        <div className="panel c-cyan icm-endpoint">
          <h3>The endpoint</h3>
          <div className="icm-code">
            <code>{endpoint}</code>
            <CopyButton text={endpoint} />
          </div>
          <p className="muted small">Set it as your base URL and your cICM key as the bearer. Anything that speaks to OpenAI speaks to this.</p>
          <details className="fold">
            <summary>Show me a working call</summary>
            <div className="inner">
              <pre className="code"><code>{`curl ${endpoint}/chat/completions \\
  -H "Authorization: Bearer cicm_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "anthropic/claude-sonnet-4",
    "messages": [{"role": "user", "content": "hello"}]
  }'`}</code></pre>
            </div>
          </details>
        </div>
      </div>

      {/* ------------------------------------------------------------------ putting credit on */}
      <section className="section">
        <div className="section-title"><h2>Putting credit on</h2></div>
        <div className="icm-buy">
          <ol className="try-steps">
            <li>
              <span className="try-n">1</span>
              <div>
                <b>Send $COMD to the address below</b>
                <span>
                  {rate?.rate.tokensPerUsd
                    ? `${Number(rate.rate.tokensPerUsd).toLocaleString()} $COMD buys $1.00 of credit.`
                    : "The rate is published below."}
                  {rate?.deposit.minimumTokens ? ` The smallest useful amount is ${Number(rate.deposit.minimumTokens).toLocaleString()} $COMD.` : ""}
                </span>
              </div>
            </li>
            <li>
              <span className="try-n">2</span>
              <div>
                <b>The credit lands on the wallet that sent it</b>
                <span>There is no memo, no account number and nothing to get wrong. Send from the wallet you want credited.</span>
              </div>
            </li>
            <li>
              <span className="try-n">3</span>
              <div>
                <b>Make a key and start calling</b>
                <span>One signature proves the wallet is yours. It is not a transaction: nothing moves and there is no gas.</span>
              </div>
            </li>
          </ol>

          <div className="panel c-crimson icm-deposit">
            <div className="label">Send $COMD here</div>
            {rate?.deposit.address ? (
              <>
                <div className="icm-code">
                  <code className="break">{rate.deposit.address}</code>
                  <CopyButton text={rate.deposit.address} />
                </div>
                {rate.deposit.paymentIsBurn && (
                  <p className="small" style={{ margin: "10px 0 0" }}>
                    <strong>This is the burn address.</strong> The $COMD you send is destroyed on the way in. The firm never
                    holds it, so there is nothing anyone could take.
                  </p>
                )}
                <p className="muted small" style={{ margin: "8px 0 0" }}>
                  Robinhood Chain{rate.deposit.chainId ? ` · ${rate.deposit.chainId}` : ""}. Only send $COMD. Anything else sent here is lost.
                </p>
              </>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>Payment watching is not switched on yet on this deployment.</p>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ the account */}
      <section className="section">
        <div className="section-title"><h2>Your account</h2></div>

        {!isConnected ? (
          <div className="panel icm-gate">
            <p>Connect the wallet you pay from. Connecting shows your balance and signs nothing until you ask it to.</p>
            <ConnectButton className="btn primary" label="Connect a wallet" />
          </div>
        ) : !view ? (
          <div className="panel icm-gate">
            <p>One signature opens your account: the balance, the keys and every call they have made.</p>
            <button type="button" className="btn primary" onClick={load} disabled={busy !== null}>
              {busy === "load" ? "Check your wallet…" : "Sign in"}
            </button>
            <p className="muted small" style={{ margin: 0 }}>Not a transaction. Nothing moves, and there is no gas.</p>
          </div>
        ) : (
          <div className="icm-account">
            <div className="icm-stats">
              <div className="icm-stat"><b>${usd(view.account.balanceMicroUsd)}</b><span>Available</span></div>
              <div className="icm-stat"><b>${usd(view.account.heldMicroUsd)}</b><span>Held by calls running now</span></div>
              <div className="icm-stat"><b>${usd(view.account.spentMicroUsd)}</b><span>Spent all time</span></div>
              <div className="icm-stat"><b>${usd(view.account.depositedMicroUsd)}</b><span>Bought all time</span></div>
            </div>
            {balance === 0n && (
              <p className="muted small">
                Nothing on the account yet. Send $COMD to the address above and it appears here within a minute or two
                of the transaction confirming.
              </p>
            )}

            {/* keys */}
            <div className="icm-keys">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <h3 style={{ margin: 0 }}>Keys</h3>
                <span className="muted small">{view.keys.length} key{view.keys.length === 1 ? "" : "s"}</span>
              </div>

              {fresh && (
                <div className="panel c-lime icm-fresh">
                  <h4>Copy this now. It is not shown again.</h4>
                  <div className="icm-code">
                    <code className="break">{fresh.secret}</code>
                    <CopyButton text={fresh.secret} label="Copy key" />
                  </div>
                  <p className="muted small" style={{ margin: 0 }}>
                    We store only a hash of it, so we could not show it to you again even if you asked. Lose it and make
                    another; revoking a lost key costs nothing.
                  </p>
                </div>
              )}

              {view.keys.length > 0 && (
                <ul className="rows icm-keylist">
                  {view.keys.map((k) => (
                    <li key={k.id}>
                      <div>
                        <code className="mono">{k.display}</code>
                        {k.label && <span className="muted small"> · {k.label}</span>}
                        {k.disabled && <span className="badge bad" style={{ marginLeft: 8 }}>off</span>}
                        <div className="muted small">
                          made {when(k.createdAt)} · spent ${usd(k.spentMicroUsd)}
                          {k.spendLimitMicroUsd ? ` of a $${usd(k.spendLimitMicroUsd)} ceiling` : ""}
                          {k.lastUsedAt ? ` · last used ${when(k.lastUsedAt)}` : " · never used"}
                        </div>
                      </div>
                      <button type="button" className="btn sm" onClick={() => revoke(k.id)} disabled={busy !== null}>
                        {busy === `revoke:${k.id}` ? "…" : "Revoke"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="icm-mint">
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="What is it for? (optional)" maxLength={80} />
                <input value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="Spend ceiling in $ (optional)" inputMode="decimal" />
                <button type="button" className="btn primary" onClick={mint} disabled={busy !== null}>
                  {busy === "mint" ? "Check your wallet…" : "Make a key"}
                </button>
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                A ceiling caps what one key can ever spend, whatever the account holds. Useful for a key you are putting
                into something you do not entirely trust.
              </p>
            </div>

            {/* history */}
            {view.deposits.length > 0 && (
              <div className="icm-history">
                <h3>Credit bought</h3>
                <ul className="rows small">
                  {view.deposits.map((d) => (
                    <li key={d.id}>
                      <span>{when(d.createdAt)}</span>
                      <span>{tokens(d.tokenUnits)} $COMD{d.burnTx ? " · burned" : ""}</span>
                      <span className="ok">+${usd(d.creditedMicroUsd)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {view.charges.length > 0 && (
              <div className="icm-history">
                <h3>Recent calls</h3>
                <ul className="rows small">
                  {view.charges.map((c) => (
                    <li key={c.id}>
                      <span>{when(c.at)}</span>
                      <span className="mono">{c.model}</span>
                      <span className="muted">{c.tokensIn.toLocaleString()} in · {c.tokensOut.toLocaleString()} out</span>
                      <span>{c.state === "settled" ? `$${usd(c.costMicroUsd)}` : c.state}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {err && <p className="err-text small" style={{ marginTop: 12 }}>{err}</p>}
      </section>

      <p className="small muted icm-foot">
        cICM is Company.md&apos;s inference desk. The same firm that files <Link href="/jobs">matters</Link> runs it, and the
        rate and the margin are published rather than discovered.
      </p>
    </div>
  );
}
