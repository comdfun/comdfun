"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePublicClient, useWriteContract } from "wagmi";
import type { Abi } from "viem";
import { contract } from "@/lib/contracts";
import { MOCK, API_URL } from "@/lib/config";
import { loadCoins, metaURI, mockCoins, website, xHandle, type Coin } from "@/lib/incorporations";
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
        <div className="grid g2" style={{ marginTop: 30, rowGap: 34 }}>
          {rows.map((c, i) => (
            <Link key={c.address} href={`/incorporations/${c.address}`} className={`folder door c-${["lime", "cyan", "pink", "gold", "orange", "violet"][i % 6]}`} data-tab={`$${c.symbol}`} style={{ minHeight: 0 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="row" style={{ gap: 10 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {c.image && /^https:\/\//.test(c.image) && <img className="coin-card-logo" src={c.image} alt="" loading="lazy" />}
                  <span className="door-t">${c.symbol}</span>
                </span>
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
  const [f, setF] = useState({ name: "", symbol: "", image: "", description: "", website: "", x: "" });
  const [logoBusy, setLogoBusy] = useState(false);
  const site = website(f.website);
  const handle = f.x.trim() ? xHandle(f.x) : null;
  const siteBad = f.website.trim() !== "" && !site;
  const xBad = f.x.trim() !== "" && !handle;
  const imageBad = f.image !== "" && !/^https:\/\//.test(f.image);
  const ok = f.name.trim().length >= 2 && /^[A-Z0-9]{2,10}$/.test(f.symbol) && !siteBad && !xBad && !imageBad && !logoBusy;
  return (
    <div className="card stack" style={{ gap: 12 }}>
      <h3 style={{ margin: 0 }}>Incorporate a coin</h3>
      <p className="small muted" style={{ margin: 0 }}>1,000,000,000 supply on a bonding curve priced in $COMD. Costs gas only.</p>
      <div className="field"><label htmlFor="cn">Name</label><input id="cn" maxLength={40} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Habeas Corpus" /></div>
      <div className="field"><label htmlFor="cs">Symbol</label><input id="cs" maxLength={10} value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} placeholder="HABEAS" /></div>
      <Logo image={f.image} onImage={(image) => setF((x) => ({ ...x, image }))} onBusy={setLogoBusy} />
      <div className="field"><label htmlFor="cd">Description</label><textarea id="cd" rows={3} maxLength={400} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <div className="coin-links">
        <div className="field">
          <label htmlFor="cw">Website <span className="muted">optional</span></label>
          <input id="cw" inputMode="url" maxLength={120} value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="yourcompany.com" aria-invalid={siteBad} />
          {siteBad && <span className="err-text small">That does not look like a web address.</span>}
        </div>
        <div className="field">
          <label htmlFor="cx">X <span className="muted">optional</span></label>
          <input id="cx" maxLength={60} value={f.x} onChange={(e) => setF({ ...f, x: e.target.value })} placeholder="@handle" aria-invalid={xBad} />
          {xBad && <span className="err-text small">An X handle is up to 15 letters, numbers or _.</span>}
        </div>
      </div>
      <TxButton label="Incorporate" disabled={!ok || !inc.address} run={() => writeContractAsync({ address: inc.address!, abi: inc.abi as Abi, functionName: "create", args: [f.name.trim(), f.symbol, metaURI({ name: f.name.trim(), symbol: f.symbol, image: f.image, description: f.description.trim(), website: site ?? undefined, twitter: handle ? `https://x.com/${handle}` : undefined })] } as never)} onDone={onCreated} />
      {!inc.address && <span className="small muted">Incorporations contract not configured.</span>}
      <p className="small muted" style={{ margin: 0 }}>Each trade: 1% to Counsel rewards, 0.5% of the ETH side to you as launcher, 0.5% of the $COMD side burned. All coins share one $COMD backing reserve.</p>
    </div>
  );
}

/**
 * The logo: pick or drop an image and it is resized here, uploaded, and its link goes into the coin's metadata.
 *
 * The metadata is written on chain, so it holds a link rather than the picture. Resizing in the browser keeps every
 * logo under 512 px and re-encodes it, which also means nothing but plain pixels is ever uploaded. A link can still
 * be pasted instead, for a logo that already lives somewhere.
 */
function Logo({ image, onImage, onBusy }: { image: string; onImage: (url: string) => void; onBusy: (b: boolean) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [paste, setPaste] = useState(false);
  const [over, setOver] = useState(false);

  async function take(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { setState("error"); setMsg("Use a PNG, JPEG, WebP or GIF."); return; }
    if (file.size > 15 * 1024 * 1024) { setState("error"); setMsg("That file is over 15 MB."); return; }
    setState("busy"); setMsg(""); onBusy(true);
    try {
      const blob = await shrink(file, 512);
      setPreview(URL.createObjectURL(blob));
      if (MOCK) { onImage("https://api.comd.fun/blobs/mock-logo"); setState("idle"); return; }
      const res = await fetch(`${API_URL}/media/logo`, { method: "POST", headers: { "content-type": blob.type }, body: blob, signal: AbortSignal.timeout(30_000) });
      const j = await res.json().catch(() => ({})) as { url?: string; detail?: string };
      if (!res.ok || !j.url) throw new Error(j.detail || `The upload failed (${res.status}).`);
      onImage(j.url);
      setState("idle");
    } catch (e) {
      setPreview(null); onImage("");
      const err = e as Error;
      setState("error");
      setMsg(err.name === "TimeoutError" ? "The upload took too long. Try again." : err instanceof TypeError ? "The upload service could not be reached. Try again in a moment, or paste a link instead." : err.message);
    } finally { onBusy(false); }
  }

  const shown = preview ?? (/^https:\/\//.test(image) ? image : null);
  return (
    <div className="field">
      <span className="label">Logo</span>
      <label className={`coin-logo${over ? " over" : ""}${shown ? " has" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void take(e.dataTransfer.files?.[0]); }}>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ""; }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {shown ? <img src={shown} alt="" /> : <span className="coin-logo-plus" aria-hidden="true">+</span>}
        <span className="coin-logo-say">
          <b>{state === "busy" ? "Uploading…" : shown ? "Replace logo" : "Add a logo"}</b>
          <span>{state === "error" ? <span className="err-text">{msg}</span> : "Drop an image or click. PNG, JPEG, WebP or GIF, resized to 512 px."}</span>
        </span>
      </label>
      <div className="row small" style={{ gap: 12 }}>
        {shown && <button type="button" className="linkish" onClick={() => { setPreview(null); onImage(""); setState("idle"); }}>Remove</button>}
        <button type="button" className="linkish" onClick={() => setPaste((p) => !p)}>{paste ? "Hide link" : "Or paste a link"}</button>
      </div>
      {paste && <input aria-label="Logo link" value={preview ? "" : image} onChange={(e) => { setPreview(null); onImage(e.target.value.trim()); }} placeholder="https://…/logo.png" />}
    </div>
  );
}

/** Fit an image inside size×size and re-encode it: WebP where the browser can, PNG where it cannot. */
async function shrink(file: File, size: number): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, size / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  if (!g) throw new Error("This browser cannot resize images.");
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const enc = (type: string, q?: number) => new Promise<Blob | null>((r) => c.toBlob(r, type, q));
  const webp = await enc("image/webp", 0.9);
  if (webp && webp.type === "image/webp") return webp;
  const png = await enc("image/png");
  if (!png) throw new Error("This browser could not encode the image.");
  return png;
}
