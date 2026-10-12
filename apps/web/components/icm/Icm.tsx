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
import { BuyCredit } from "./BuyCredit";
import { Catalogue } from "./Catalogue";
import { Dash, SAMPLE } from "./Dash";
import { Live } from "./Live";
import { Try } from "./Try";

type Rate = {
  enabled: boolean;
  reason: string | null;
  endpoint: string;
  rate: { tokensPerUsd: string; symbol: string; marginBps: number };
  deposit: { address: string | null; token?: string; symbol?: string; decimals?: number; tokensPerUsd?: string; paymentIsBurn?: boolean; burns?: boolean; sink?: string; minimumTokens?: string; note: string; problem?: string | null; chainId?: number };
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
  // The route handler this calls has its own deadline, but a button must never be able to spin forever: if the
  // handler itself is wedged, this is the thing that unsticks it and puts a sentence on the screen.
  const res = await fetch(`/api/icm${path}`, {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  }).catch((e: Error) => {
    if (e.name === "TimeoutError" || e.name === "AbortError") throw new Error("cICM did not answer in time. Try again in a moment.");
    throw new Error("cICM could not be reached from this browser. Check your connection and try again.");
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
  // What the button should say while it is busy. "Check your wallet" is a promise, so it is only made once the
  // wallet has actually been asked: before that the page is still talking to the control plane, and telling
  // somebody to look at a wallet that was never prompted sends them hunting for a window that does not exist.
  const [stage, setStage] = useState<"server" | "wallet">("server");
  const [err, setErr] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ secret: string; label: string | null } | null>(null);
  const [label, setLabel] = useState("");
  const [limit, setLimit] = useState("");

  useEffect(() => { api<Rate>("").then(setRate).catch(() => setRate(null)); }, []);
  // The account view is behind a signature, so it is not loaded until asked for. Opening the page signs nothing.
  useEffect(() => { setView(null); setFresh(null); }, [address]);

  /** Ask for a nonce, sign it, and post the proof with whatever else the call needs. */
  const proved = useCallback(async (extra: Record<string, unknown> = {}) => {
    if (!address) throw new Error("Connect a wallet first.");
    const { message } = await api<{ nonce: string; message: string }>("/nonce", { method: "POST", body: { address } });
    setStage("wallet");
    const signature = await signMessageAsync({ message });
    setStage("server");
    return { address, signature, ...extra };
  }, [address, signMessageAsync]);

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what); setErr(null); setStage("server");
    try { await fn(); }
    catch (e) {
      const m = (e as Error).message;
      setErr(/denied|rejected|User rejected|user rejected/i.test(m) ? "You cancelled the signature, so nothing happened." : m);
    }
    finally { setBusy(null); setStage("server"); }
  };

  /** What a busy button says. One label for the wait on us, another for the wait on them. */
  const saying = (own: string, idle: string) =>
    busy === own ? (stage === "wallet" ? "Check your wallet…" : "Working…") : idle;

  const load = () => run("load", async () => { setView(await api<AccountView>("/account", { method: "POST", body: await proved() })); });

  // One action, one signature. Reloading the whole account view after a write would mean a second prompt for the
  // same click, which reads like something went wrong, so the write's own answer is folded into the view instead.
  const mint = () => run("mint", async () => {
    const out = await api<{ secret: string; key: Key }>("/keys", {
      method: "POST",
      body: await proved({ label: label.trim() || undefined, spendLimitUsd: limit.trim() || undefined }),
    });
    setFresh({ secret: out.secret, label: out.key.label });
    setLabel(""); setLimit("");
    setView((v) => (v ? { ...v, keys: [out.key, ...v.keys] } : v));
  });

  const revoke = (id: string) => run(`revoke:${id}`, async () => {
    await api(`/keys/${id}/revoke`, { method: "POST", body: await proved() });
    setView((v) => (v ? { ...v, keys: v.keys.map((k) => (k.id === id ? { ...k, disabled: true } : k)) } : v));
  });

  const endpoint = rate?.endpoint ?? "https://api.comd.fun/icm/v1";
  const balance = view ? BigInt(view.account.balanceMicroUsd) : 0n;

  const perUsd = rate ? Number(rate.rate.tokensPerUsd) : null;
  const margin = rate ? `${(rate.rate.marginBps / 100).toFixed(rate.rate.marginBps % 100 === 0 ? 0 : 2)}%` : "15%";

  return (
    <div className="icm">
      {/* ------------------------------------------------------------------- the hero
          The buy panel sits with the pitch rather than four screens below it: it is the only control on the
          page and the reason anybody is here. */}
      <section className="icm-hero">
        <div className="icm-pitch">
          <h2 className="icm-big">
            Every frontier model,<br />
            one key, <mark>paid in $COMD</mark>.
          </h2>
          <p className="icm-lede">
            No card, no subscription, and no account of your own with a model provider. Point any client at one
            endpoint and name the model you want.
          </p>

          <div className="icm-figs">
            <div className="icm-fig"><b>{perUsd ? perUsd.toLocaleString() : "—"}</b><span>$COMD buys $1.00 of credit</span></div>
            <div className="icm-fig"><b>$0</b><span>setup, subscription or minimum monthly</span></div>
            <div className="icm-fig icm-fig-hot"><b>100%</b><span>of the $COMD you spend is burned</span></div>
          </div>

          <div className="icm-wire">
            <div className="icm-wire-head">
              <span>Base URL</span>
              <CopyButton text={endpoint} />
            </div>
            <code className="icm-url">{endpoint}</code>
            <pre className="icm-curl"><code>{`curl ${endpoint}/chat/completions \\
  -H "Authorization: Bearer cicm_live_…" \\
  -d '{"model":"anthropic/claude-sonnet-4",
       "messages":[{"role":"user","content":"hello"}]}'`}</code></pre>
          </div>
        </div>

        <div className="icm-buyside">
          {rate?.deposit.address ? (
            <>
              <BuyCredit deposit={rate.deposit} onDone={() => { if (view) void load(); }} />
              <details className="icm-manual">
                <summary>Or send it yourself</summary>
                <code className="icm-addr">{rate.deposit.address}</code>
                <CopyButton text={rate.deposit.address} label="Copy address" />
                <ul className="icm-ticket-fine">
                  <li>Robinhood Chain{rate.deposit.chainId ? `, chain ${rate.deposit.chainId}` : ""}</li>
                  <li>$COMD only. Anything else sent here is lost.</li>
                  {rate.deposit.burns && <li className="warn">What you send is destroyed. Credit is bought by taking $COMD out of supply.</li>}
                </ul>
              </details>
            </>
          ) : (
            <div className="icm-ticket">
              <span className="icm-ticket-label">Send $COMD to</span>
              <p className="muted small" style={{ margin: 0 }}>
                {rate?.deposit.problem ?? "Payments are not being watched yet, so credit cannot be bought."}
              </p>
            </div>
          )}
          {rate && !rate.enabled && (
            <p className="icm-warn">
              {rate.reason?.includes("misconfigured")
                ? "The desk is switched off while it is reconfigured. Nothing can be bought or spent."
                : "Routing is not switched on yet. You can buy credit and make keys now; calls start working with nothing further from you."}
            </p>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------------- three facts */}
      <section className="icm-facts">
        <div className="icm-fact"><b>Straight relay</b><span>Your request goes to the model you named. Nothing is swapped for something cheaper, and the answer carries the provider&apos;s own model id so you can check.</span></div>
        <div className="icm-fact"><b>Charged what it cost</b><span>A call holds an estimate when it opens and settles on the provider&apos;s own usage figure. A call that never ran is never charged for, and an interrupted one gives the hold back.</span></div>
        <div className="icm-fact icm-fact-hot"><b>Burned on the way in</b><span>Every $COMD that buys credit is destroyed. Buying inference takes supply off the market for good, so demand for models is demand for the token.</span></div>
      </section>

      {/* ------------------------------------------------------------------ the desk, live */}
      <Live />

      {/* ------------------------------------------------------------------ catalogue */}
      <section className="icm-cat">
        <div className="icm-cat-say">
          <h2>Every model, one key.</h2>
          <p>One key reaches all of them. What a call costs is what the provider charged plus the published margin.</p>
        </div>
        <Catalogue />
      </section>

      {/* ------------------------------------------------------- playground and quickstart */}
      <Try endpoint={endpoint} />

      {/* ------------------------------------------------------------------- funding */}
      <section className="icm-fund">
        <div className="icm-fund-say">
          <h2>Putting credit on</h2>
          <p>
            Pay in $COMD, or in ETH and the pool does the swap on the way in. Either way it is one transaction,
            there is no memo and no account number, and the credit lands on the wallet that paid, usually within
            a minute of it confirming.
          </p>
          <p className="muted small">
            Then one signature proves that wallet is yours and you can mint a key. The signature is not a
            transaction: nothing moves and there is no gas.
          </p>

          {/* Coming from anywhere else. Robinhood Chain is new, so no card processor sells onto it directly;
              what does exist is a short hop from a chain that every exchange already withdraws to. Saying that
              plainly beats an on-ramp widget that would quietly not cover this chain. */}
          <div className="icm-route">
            <h3>Arriving from another chain, or from cash</h3>
            <ol className="icm-steps">
              <li>
                <b>Get ETH anywhere you already can</b>
                <span>An exchange, a card on-ramp, a wallet you already hold it in. Any chain those will send to.</span>
              </li>
              <li>
                <b>Bridge it to Robinhood Chain</b>
                <span>
                  <a className="ext" href="https://relay.link/bridge/robinhood" target="_blank" rel="noreferrer">Relay</a>{" "}
                  and <a className="ext" href="https://across.to/?to=robinhood" target="_blank" rel="noreferrer">Across</a>{" "}
                  take seconds from most chains.{" "}
                  <a className="ext" href="https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain&sourceChain=ethereum" target="_blank" rel="noreferrer">The canonical bridge</a>{" "}
                  is the slower, trust-minimised route from Ethereum.
                </span>
              </li>
              <li>
                <b>Come back and pay in ETH</b>
                <span>The panel does the rest in one transaction. Nothing else to buy or approve by hand.</span>
              </li>
            </ol>
            <p className="muted small" style={{ margin: 0 }}>
              Those are third-party services. Nothing here is financial advice.
            </p>
          </div>
        </div>

        <dl className="icm-terms">
          <dt>Price of a call</dt>
          <dd>What the model provider charged, plus {margin}.</dd>
          <dt>Minimum</dt>
          <dd>{rate?.deposit.minimumTokens ? `${Number(rate.deposit.minimumTokens).toLocaleString()} $COMD` : "—"}</dd>
          <dt>Settlement</dt>
          <dd>Held when the call opens, settled on the provider&apos;s own figure.</dd>
          {rate?.deposit.burns && (
            <>
              <dt>Supply</dt>
              <dd className="icm-burnline">Every $COMD spent here is <b>burned</b>.</dd>
            </>
          )}
        </dl>
      </section>

      {/* ------------------------------------------------------------------ the account */}
      <section className="section">
        <div className="section-title"><h2>Your account</h2></div>

        {!view ? (
          <div className="icm-preview">
            {/* A dashboard of zeroes tells a first-time visitor nothing about what they would get, and invented
                numbers presented as real would be a lie. A sample that says it is a sample is neither. */}
            <Dash account={SAMPLE.account} charges={SAMPLE.charges} isSample />
            <div className="panel icm-gate">
              {!isConnected ? (
                <>
                  <p><b>This is a sample.</b> Connect the wallet you pay from to see your own: the balance, every call and what it cost. Connecting signs nothing until you ask it to.</p>
                  <ConnectButton className="btn primary" label="Connect a wallet" />
                </>
              ) : (
                <>
                  <p><b>This is a sample.</b> One signature opens your own account: the balance, the keys and every call they have made.</p>
                  <button type="button" className="btn primary" onClick={load} disabled={busy !== null}>
                    {saying("load", "Sign in")}
                  </button>
                  <p className="muted small" style={{ margin: 0 }}>Not a transaction. Nothing moves, and there is no gas.</p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="icm-account">
            <Dash account={view.account} charges={view.charges} />
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
                  {saying("mint", "Make a key")}
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
