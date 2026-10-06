"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { erc20Abi, formatUnits, parseUnits, type Abi, type Address } from "viem";
import { contract } from "@/lib/contracts";
import { MOCK } from "@/lib/config";
import { MOCK_CHAIN } from "@/lib/mock-chain";
import { coinInfo, loadTrades, mockCoins, mockPrice, parseMeta, type TradeRow } from "@/lib/incorporations";
import { explorerUrl } from "@/lib/chains";
import { fmtNum, short, units } from "@/lib/format";
import { TxButton } from "../tx/TxButton";

const E18 = 10n ** 18n;
const SUPPLY = 1_000_000_000;

function Chart({ points, marker, label }: { points: [number, number][]; marker?: number; label: string }) {
  if (points.length < 2) return <div className="empty">No trades yet. The curve starts at its floor price.</div>;
  const W = 160, H = 70;
  const maxY = Math.max(...points.map((p) => p[1])) * 1.08 || 1;
  const X = (x: number) => Math.round(4 + x * (W - 8));
  const Y = (y: number) => Math.round(H - 6 - (y / maxY) * (H - 12));
  // stepped path on the pixel grid
  let d = `M${X(points[0][0])} ${Y(points[0][1])}`;
  for (let i = 1; i < points.length; i++) d += ` H${X(points[i][0])} V${Y(points[i][1])}`;
  const fill = `${d} V${H - 6} H${X(points[0][0])} Z`;
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} shapeRendering="crispEdges" style={{ width: "100%", height: "auto", border: "2px solid var(--rule)", background: "#000", display: "block" }}>
        {[0.25, 0.5, 0.75].map((g) => <rect key={g} x={4} y={Y(maxY * g)} width={W - 8} height={0.5} fill="#262626" />)}
        <path d={fill} fill="#c9a227" opacity={0.12} />
        <path d={d} stroke="#c9a227" strokeWidth={1} fill="none" />
        {marker != null && (
          <>
            <rect x={X(marker) - 0.5} y={6} width={1} height={H - 12} fill="#4fa38a" />
            <rect x={X(marker) - 1.5} y={Y(points.reduce((a, p) => (p[0] <= marker ? p[1] : a), points[0][1])) - 1.5} width={3} height={3} fill="#4fa38a" />
          </>
        )}
        <rect x={4} y={H - 6} width={W - 8} height={1} fill="#3a3a3a" />
      </svg>
      <figcaption className="small muted" style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span>0% sold</span><span>{label}</span><span>100%</span>
      </figcaption>
    </figure>
  );
}

export function CoinDetail({ address }: { address: Address }) {
  const inc = contract("Incorporations");
  const router = contract("ComdRouter");
  const token = contract("ComdToken");
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const mock = !inc.address && MOCK ? mockCoins().find((c) => c.address.toLowerCase() === address.toLowerCase()) : undefined;
  const [info, setInfo] = useState<{ name: string; symbol: string; totalSupply?: bigint; image?: string; description?: string; creator?: string } | null>(mock ? { name: mock.name, symbol: mock.symbol, creator: mock.creator } : null);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [via, setVia] = useState<"eth" | "comd">("eth");
  const [amt, setAmt] = useState("");
  const [out, setOut] = useState<bigint | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!inc.address || !client) return;
    coinInfo(client, address).then((i) => setInfo((x) => ({ ...x, ...i }))).catch((e) => setErr((e as Error).message.split("\n")[0]));
    loadTrades(client, address).then(setTrades).catch(() => {});
    client.getContractEvents({ address: inc.address, abi: inc.abi as Abi, eventName: "CoinCreated", args: { coin: address }, fromBlock: 0n } as never).then((l) => {
      const a = (l as unknown as { args: { creator: string; metadataURI: string } }[])[0]?.args;
      if (a) setInfo((x) => ({ ...(x ?? { name: "", symbol: "" }), creator: a.creator, ...parseMeta(a.metadataURI) }));
    }).catch(() => {});
  }, [inc.address, client, address]);


  // price points: mock curve, or the traded path (cumulative sold vs price per trade)
  const { points, marker, last } = useMemo(() => {
    if (mock) {
      const pts: [number, number][] = Array.from({ length: 41 }, (_, i) => [i / 40, mockPrice(i / 40)]);
      return { points: pts, marker: mock.supplySold, last: mockPrice(mock.supplySold ?? 0) };
    }
    let sold = 0;
    const pts: [number, number][] = [[0, 0]];
    for (const t of trades) {
      const c = Number(formatUnits(t.coinAmount, 18));
      sold += t.isBuy ? c : -c;
      const p = c ? Number(formatUnits(t.comdAmount, 18)) / c : 0;
      pts.push([Math.max(0, sold) / SUPPLY, p]);
    }
    if (pts.length > 1) pts[0] = [0, pts[1][1]];
    return { points: pts, marker: Math.max(0, sold) / SUPPLY, last: pts[pts.length - 1][1] };
  }, [mock, trades]);

  let amountIn = 0n;
  try { amountIn = amt ? parseUnits(amt, 18) : 0n; } catch {}

  useEffect(() => {
    setOut(null);
    if (!amountIn) return;
    const t = setTimeout(async () => {
      try {
        if (mock) {
          const company = via === "eth" ? amountIn * MOCK_CHAIN.swap.comdPerEth : amountIn;
          const p = last || 0.00002;
          if (side === "buy") setOut(BigInt(Math.floor(Number(formatUnits(company, 18)) / p)) * E18);
          else { const co = BigInt(Math.floor(Number(formatUnits(amountIn, 18)) * p * 1e6)) * 10n ** 12n; setOut(via === "eth" ? co / MOCK_CHAIN.swap.comdPerEth : co); }
          return;
        }
        if (!inc.address || !client) return;
        if (side === "buy") {
          let company = amountIn;
          if (via === "eth") company = (await client.simulateContract({ address: router.address!, abi: router.abi as Abi, functionName: "quoteETHForComd", args: [amountIn] } as never)).result as bigint;
          setOut((await client.readContract({ address: inc.address, abi: inc.abi as Abi, functionName: "quoteBuy", args: [address, company] })) as bigint);
        } else {
          const company = (await client.readContract({ address: inc.address, abi: inc.abi as Abi, functionName: "quoteSell", args: [address, amountIn] })) as bigint;
          setOut(via === "eth" ? ((await client.simulateContract({ address: router.address!, abi: router.abi as Abi, functionName: "quoteComdForETH", args: [company] } as never)).result as bigint) : company);
        }
      } catch (e) { setErr((e as Error).message.split("\n")[0]); }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amt, side, via, last]);

  const minOut = out != null ? (out * 99n) / 100n : 0n;
  const payUnit = side === "buy" ? (via === "eth" ? "ETH" : "COMD") : info?.symbol ?? "COIN";
  const getUnit = side === "buy" ? info?.symbol ?? "COIN" : via === "eth" ? "ETH" : "COMD";
  const run = () => {
    const base = { address: inc.address!, abi: inc.abi as Abi };
    if (side === "buy" && via === "eth") return writeContractAsync({ ...base, functionName: "buyWithETH", args: [address, minOut], value: amountIn } as never);
    if (side === "buy") return writeContractAsync({ ...base, functionName: "buyWithComd", args: [address, amountIn, minOut] } as never);
    if (via === "eth") return writeContractAsync({ ...base, functionName: "sellForETH", args: [address, amountIn, minOut] } as never);
    return writeContractAsync({ ...base, functionName: "sellForComd", args: [address, amountIn, minOut] } as never);
  };
  const approveToken = side === "buy" ? (via === "comd" ? token.address : undefined) : address;

  return (
    <div className="two-col">
      <div className="stack">
        <div className="row" style={{ gap: 14 }}>
          {info?.image && /^https:\/\//.test(info.image) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={info.image} alt="" width={56} height={56} style={{ border: "2px solid var(--rule)" }} />
          )}
          <div>
            <h1 style={{ margin: 0 }}>${info?.symbol ?? "…"}</h1>
            <div className="muted">{info?.name}{mock && <span className="tag" style={{ marginLeft: 8 }}>mock</span>}</div>
          </div>
        </div>
        {info?.description && <p>{info.description}</p>}
        <div className="stats">
          <div className="stat"><span className="v">{last ? last.toExponential(2) : "—"}</span><span className="k">Price · COMD per coin</span></div>
          <div className="stat"><span className="v">{marker != null ? `${(marker * 100).toFixed(1)}%` : "—"}</span><span className="k">Curve sold</span></div>
          <div className="stat"><span className="v">{mock ? fmtNum(mock.trades) : fmtNum(trades.length)}</span><span className="k">Trades</span></div>
          <div className="stat"><span className="v">1B</span><span className="k">Supply</span></div>
        </div>
        <Chart points={points} marker={marker} label={mock ? "bonding curve (mock)" : "price along the curve, by trade"} />
        <dl className="kv">
          <dt>Coin</dt><dd><a className="mono ext break" href={explorerUrl("token", address)} target="_blank" rel="noreferrer">{address}</a></dd>
          <dt>Launcher</dt><dd>{info?.creator ? <a className="mono ext" href={explorerUrl("address", info.creator)} target="_blank" rel="noreferrer">{short(info.creator)}</a> : "—"}</dd>
          <dt>Fees</dt><dd>1% to Counsel rewards · 0.5% of the ETH side to the launcher · 0.5% of the $COMD side burned</dd>
          <dt>Backing</dt><dd>One $COMD reserve shared by every coin. Paying with ETH routes through the official COMD/ETH pool, so every buy is a $COMD buy.</dd>
          <dt>Graduation</dt><dd className="muted">Phase 2: at a $COMD threshold, liquidity migrates to a v4 COMD pool.</dd>
        </dl>
        {!mock && trades.length > 0 && (
          <div className="table-wrap">
            <table className="table collapse">
              <thead><tr><th>Side</th><th>Trader</th><th className="num">Coin</th><th className="num">COMD</th><th className="num">ETH</th><th>Tx</th></tr></thead>
              <tbody>
                {trades.slice(-25).reverse().map((t) => (
                  <tr key={t.tx + t.coinAmount}>
                    <td data-k="Side" className={t.isBuy ? "ok" : "bad"}>{t.isBuy ? "Buy" : "Sell"}</td>
                    <td data-k="Trader" className="mono small">{short(t.trader)}</td>
                    <td data-k="Coin" className="num">{units(t.coinAmount, 18, 0)}</td>
                    <td data-k="COMD" className="num">{units(t.comdAmount, 18, 2)}</td>
                    <td data-k="ETH" className="num">{t.ethAmount ? units(t.ethAmount, 18, 4) : "—"}</td>
                    <td data-k="Tx"><a className="ext mono small" href={explorerUrl("tx", t.tx)} target="_blank" rel="noreferrer">{t.tx.slice(0, 10)}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <aside>
        <div className="card" style={{ display: "grid", gap: 14 }}>
          <div className="seg" role="group" aria-label="Buy or sell">
            <button type="button" aria-pressed={side === "buy"} onClick={() => setSide("buy")}>Buy</button>
            <button type="button" aria-pressed={side === "sell"} onClick={() => setSide("sell")}>Sell</button>
          </div>
          <div className="seg" role="group" aria-label={side === "buy" ? "Pay with" : "Receive"}>
            <button type="button" aria-pressed={via === "eth"} onClick={() => setVia("eth")}>{side === "buy" ? "Pay ETH" : "Get ETH"}</button>
            <button type="button" aria-pressed={via === "comd"} onClick={() => setVia("comd")}>{side === "buy" ? "Pay COMD" : "Get COMD"}</button>
          </div>
          <div className="field">
            <label htmlFor="inc-amt">You pay</label>
            <div className="amount"><input id="inc-amt" inputMode="decimal" placeholder="0.0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /><span className="unit">{payUnit}</span></div>
          </div>
          <div className="small">You receive about <span className="px" style={{ fontSize: 13 }}>{out != null ? units(out, 18, getUnit === "ETH" ? 6 : 2) : "—"}</span> {getUnit}. Minimum 1% lower.</div>
          {approveToken && <ApproveThen token={approveToken} spender={inc.address} amount={amountIn} run={run} label={side === "buy" ? "Buy" : "Sell"} disabled={!amountIn || out == null} />}
          {!approveToken && <TxButton label="Buy" disabled={!inc.address || !amountIn || out == null} run={run} onDone={() => setAmt("")} />}
          {!inc.address && <span className="small muted">Incorporations contract not configured{mock ? "; quotes are mock" : ""}.</span>}
          {err && <span className="small err-text">{err}</span>}
        </div>
      </aside>
    </div>
  );
}

function ApproveThen({ token, spender, amount, run, label, disabled }: { token: Address; spender?: Address; amount: bigint; run: () => Promise<`0x${string}`>; label: string; disabled?: boolean }) {
  const { address } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [allow, setAllow] = useState<bigint>(0n);
  const refresh = () => { if (address && spender && client) client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [address, spender] }).then(setAllow).catch(() => {}); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [address, spender, token]);
  if (spender && allow < amount) return <TxButton label="Approve" disabled={disabled} run={() => writeContractAsync({ address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount] })} onDone={refresh} />;
  return <TxButton label={label} disabled={disabled || !spender} run={run} />;
}
