"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePublicClient, useWriteContract } from "wagmi";
import type { Abi } from "viem";
import { contract } from "@/lib/contracts";
import { MOCK } from "@/lib/config";
import { loadCoins, metaURI, mockCoins, type Coin } from "@/lib/incorporations";
import { short, fmtNum } from "@/lib/format";
import { TxButton } from "../tx/TxButton";
import { NotDeployed } from "../Mocked";

export function CoinList() {
  const inc = contract("Incorporations");
  const client = usePublicClient();
  const [coins, setCoins] = useState<Coin[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const reload = () => {
    if (!inc.address) { setCoins(MOCK ? mockCoins() : []); return; }
    loadCoins(client!).then(setCoins).catch((e) => { setErr((e as Error).message.split("\n")[0]); setCoins([]); });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [inc.address]);
  const rows = (coins ?? []).filter((c) => !q || `${c.name} ${c.symbol} ${c.address}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="two-col">
      <div>
        {!inc.address && !MOCK && <NotDeployed name="Incorporations" />}
        <div className="toolbar">
          <div className="tabs"><span className="tab" aria-current="page">All <span className="n">{coins ? fmtNum(coins.length) : "—"}</span></span></div>
          <div className="search"><label className="sr-only" htmlFor="cq">Search coins</label><input id="cq" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, symbol or address" /></div>
        </div>
        {coins === null && <p className="muted">Reading the chain…</p>}
        {err && <p className="err-text small">{err}</p>}
        {coins && rows.length === 0 && <div className="empty"><span className="px">No company coins yet.</span>Incorporate the first one.</div>}
        <div className="grid g2 rv-kids" style={{ marginTop: 30, rowGap: 34 }}>
          {rows.map((c, i) => (
            <Link key={c.address} href={`/incorporations/${c.address}`} className={`folder door rv c-${["lime", "cyan", "pink", "gold", "orange", "violet"][i % 6]}`} data-tab={`$${c.symbol}`} style={{ minHeight: 0 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="door-t">${c.symbol}</span>
                {c.mock && <span className="tag">mock</span>}
              </div>
              <span>{c.name}</span>
              {c.supplySold != null && (<><div className="meter" style={{ ["--c" as string]: "inherit" }} aria-label={`${Math.round(c.supplySold * 100)}% of the curve sold`}><span style={{ width: `${c.supplySold * 100}%` }} /></div><span className="door-s">{Math.round(c.supplySold * 100)}% of the curve · {fmtNum(c.comdReserve)} COMPANY backing · {fmtNum(c.trades)} trades</span></>)}
              <span className="door-s">by {short(c.creator)}{c.createdAgo != null ? ` · ${c.createdAgo}d ago` : ""}</span>
            </Link>
          ))}
        </div>
      </div>
      <aside className="stack"><CreateCoin onCreated={reload} /></aside>
    </div>
  );
}

function CreateCoin({ onCreated }: { onCreated: () => void }) {
  const inc = contract("Incorporations");
  const { writeContractAsync } = useWriteContract();
  const [f, setF] = useState({ name: "", symbol: "", image: "", description: "" });
  const ok = f.name.trim().length >= 2 && /^[A-Z0-9]{2,10}$/.test(f.symbol);
  return (
    <div className="card stack" style={{ gap: 12 }}>
      <h3 style={{ margin: 0 }}>Incorporate a coin</h3>
      <p className="small muted" style={{ margin: 0 }}>1,000,000,000 supply on a bonding curve priced in $COMD. Costs gas only.</p>
      <div className="field"><label htmlFor="cn">Name</label><input id="cn" maxLength={40} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Habeas Corpus" /></div>
      <div className="field"><label htmlFor="cs">Symbol</label><input id="cs" maxLength={10} value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} placeholder="HABEAS" /></div>
      <div className="field"><label htmlFor="ci">Image URL</label><input id="ci" value={f.image} onChange={(e) => setF({ ...f, image: e.target.value.trim() })} placeholder="https://…/logo.png" /></div>
      <div className="field"><label htmlFor="cd">Description</label><textarea id="cd" rows={3} maxLength={400} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <TxButton label="Incorporate" disabled={!ok || !inc.address} run={() => writeContractAsync({ address: inc.address!, abi: inc.abi as Abi, functionName: "create", args: [f.name.trim(), f.symbol, metaURI(f)] } as never)} onDone={onCreated} />
      {!inc.address && <span className="small muted">Incorporations contract not configured.</span>}
      <p className="small muted" style={{ margin: 0 }}>Each trade: 1% to Counsel rewards, 0.5% of the ETH side to you as launcher, 0.5% of the $COMD side burned. All coins share one $COMD backing reserve.</p>
    </div>
  );
}
