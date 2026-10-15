"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { erc20Abi, formatUnits, parseUnits, type Abi, type Address } from "viem";
import { abiOf, contract } from "@/lib/contracts";
import { useRead } from "@/lib/useChain";
import { MOCK, PONS_URL, UNISWAP_URL } from "@/lib/config";
import { MOCK_CHAIN } from "@/lib/mock-chain";
import { coinInfo, loadTrades, mockCoins, mockPrice, mockTicks, parseMeta, tradeTicks, type Tick, type TradeRow } from "@/lib/incorporations";
import { CoinChart, fmtPrice } from "./CoinChart";
import { isHiddenCoin } from "@/lib/hidden-coins";
import { explorerUrl } from "@/lib/chains";
import { fmtNum, short, units } from "@/lib/format";
import { TxButton } from "../tx/TxButton";

const E18 = 10n ** 18n;
const SUPPLY = 1_000_000_000;

export function CoinDetail({ address }: { address: Address }) {
  const inc = contract("Incorporations");
  const token = contract("ComdToken");
  // ETH legs route through the pluggable swapper (Pons's graduated pool); until Incorporations.swapper() is set,
  // trading is COMD-only
  const swapperRead = useRead<Address>("Incorporations", "swapper", [], undefined, { watch: true });
  const swapperAddr = swapperRead.value && !/^0x0{40}$/i.test(swapperRead.value) ? swapperRead.value : undefined;
  const ethEnabled = inc.address ? !!swapperAddr : MOCK && MOCK_CHAIN.swap.swapperConfigured;
  const swapper = { address: swapperAddr, abi: abiOf("Swapper") };
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const mock = !inc.address && MOCK ? mockCoins().find((c) => c.address.toLowerCase() === address.toLowerCase()) : undefined;
  const [info, setInfo] = useState<{ name: string; symbol: string; totalSupply?: bigint; image?: string; description?: string; website?: string; twitter?: string; creator?: string } | null>(mock ? { name: mock.name, symbol: mock.symbol, creator: mock.creator } : null);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [ticks, setTicks] = useState<Tick[] | null>(mock ? mockTicks(address, mock.supplySold ?? 0.4) : null);
  // the curve's price right now and when the coin was made, so the chart has something true to show before any trade
  const [spot, setSpot] = useState<number | null>(null);
  const [since, setSince] = useState<number | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [viaPick, setVia] = useState<"eth" | "comd">("comd");
  const via = ethEnabled ? viaPick : "comd";
  const [amt, setAmt] = useState("");
  const [out, setOut] = useState<bigint | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // graduation: on the curve until the $COMD reserve reaches the threshold, then a Uniswap v4 coin/$COMD pool
  const [grad, setGrad] = useState<{ done: boolean; reserve: bigint; threshold: bigint; poolId?: string; fee?: number } | null>(null);

  useEffect(() => {
    if (!inc.address || !client) return;
    (async () => {
      try {
        const [ci, th, g] = await Promise.all([
          client.readContract({ address: inc.address!, abi: inc.abi as Abi, functionName: "coinInfo", args: [address] }) as Promise<{ comdReserve: bigint }>,
          client.readContract({ address: inc.address!, abi: inc.abi as Abi, functionName: "graduationThreshold" }) as Promise<bigint>,
          client.readContract({ address: inc.address!, abi: inc.abi as Abi, functionName: "graduationInfo", args: [address] }) as Promise<{ done: boolean; key: { fee: number }; liquidity: bigint }>,
        ]);
        setGrad({ done: g.done, reserve: ci.comdReserve, threshold: th, fee: g.key?.fee });
      } catch { /* older deployment without graduation */ }
    })();
    coinInfo(client, address).then((i) => setInfo((x) => ({ ...x, ...i }))).catch((e) => setErr((e as Error).message.split("\n")[0]));
    // trades, and the chart drawn from them; read again every 20 seconds so a new trade shows up on its own
    let live = true;
    const pull = () => loadTrades(client, address)
      .then(async (t) => { if (!live) return; setTrades(t); const k = await tradeTicks(client, t); if (live) setTicks(k); })
      .then(() => client.readContract({ address: inc.address!, abi: inc.abi as Abi, functionName: "spotPrice", args: [address] }) as Promise<bigint>)
      .then((p) => { if (live && p) setSpot(Number(p) / 1e18); })
      .catch(() => { if (live) setTicks((x) => x ?? []); });
    void pull();
    const timer = setInterval(pull, 20_000);
    client.getContractEvents({ address: inc.address, abi: inc.abi as Abi, eventName: "CoinCreated", args: { coin: address }, fromBlock: 0n } as never).then((l) => {
      const first = (l as unknown as { args: { creator: string; metadataURI: string; name: string; symbol: string }; blockNumber: bigint }[])[0];
      const a = first?.args;
      if (a) setInfo((x) => ({ ...(x ?? { name: a.name, symbol: a.symbol }), name: x?.name || a.name, symbol: x?.symbol || a.symbol, creator: a.creator, ...parseMeta(a.metadataURI) }));
      if (first?.blockNumber != null) client.getBlock({ blockNumber: first.blockNumber }).then((b) => live && setSince(Number(b.timestamp))).catch(() => {});
    }).catch(() => {});
    return () => { live = false; clearInterval(timer); };
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
    return { points: pts, marker: Math.min(1, Math.max(0, sold) / SUPPLY), last: pts[pts.length - 1][1] };
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
          if (via === "eth") company = (await client.simulateContract({ address: swapper.address!, abi: swapper.abi as Abi, functionName: "quoteETHForComd", args: [amountIn] } as never)).result as bigint;
          setOut((await client.readContract({ address: inc.address, abi: inc.abi as Abi, functionName: "quoteBuy", args: [address, company] })) as bigint);
        } else {
          const company = (await client.readContract({ address: inc.address, abi: inc.abi as Abi, functionName: "quoteSell", args: [address, amountIn] })) as bigint;
          setOut(via === "eth" ? ((await client.simulateContract({ address: swapper.address!, abi: swapper.abi as Abi, functionName: "quoteComdForETH", args: [company] } as never)).result as bigint) : company);
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

  if (isHiddenCoin({ address, symbol: info?.symbol, name: info?.name })) {
    return <div className="empty"><span className="px">No such coin.</span>It is not listed on this site.</div>;
  }

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
        {(info?.website || info?.twitter) && (
          <div className="coin-social">
            {info.website && <a href={info.website} target="_blank" rel="noopener noreferrer nofollow">{info.website.replace(/^https:\/\/(www\.)?/, "")} ↗</a>}
            {info.twitter && <a href={info.twitter} target="_blank" rel="noopener noreferrer nofollow">@{info.twitter.replace(/^https:\/\/(www\.)?(x|twitter)\.com\//, "").split(/[/?#]/)[0]} on X ↗</a>}
          </div>
        )}
        <div className="stats">
          <div className="stat"><span className="v">{last ? fmtPrice(last) : spot ? fmtPrice(spot) : "—"}</span><span className="k">Price · COMD per coin</span></div>
          <div className="stat"><span className="v">{marker != null ? `${(marker * 100).toFixed(1)}%` : "—"}</span><span className="k">Curve sold</span></div>
          <div className="stat"><span className="v">{mock ? fmtNum(mock.trades) : fmtNum(trades.length)}</span><span className="k">Trades</span></div>
          <div className="stat"><span className="v">1B</span><span className="k">Supply</span></div>
        </div>
        <CoinChart ticks={ticks} symbol={info?.symbol ?? "COIN"} spot={mock ? mockPrice(mock.supplySold ?? 0) : spot} since={since} />
        <dl className="kv">
          <dt>Coin</dt><dd><a className="mono ext break" href={explorerUrl("token", address)} target="_blank" rel="noreferrer">{address}</a></dd>
          <dt>Launcher</dt><dd>{info?.creator ? <a className="mono ext" href={explorerUrl("address", info.creator)} target="_blank" rel="noreferrer">{short(info.creator)}</a> : "—"}</dd>
          <dt>Fees</dt><dd>1% to agent rewards · 0.5% to the launcher · 0.5% of the $COMD side burned (sent to the dead address)</dd>
          <dt>Backing</dt><dd>One $COMD reserve shared by every coin. Paying with ETH routes through the $COMD pool on Uniswap (after graduation on Pons), so every buy is a $COMD buy.</dd>
          <dt>Graduation</dt>
          <dd>
            {grad?.done ? (
              <><span className="badge ok fill">Graduated</span> This coin now trades on Uniswap v4, paired with $COMD{grad.fee ? ` (${grad.fee / 10_000}% pool fee)` : ""}. Its whole $COMD backing and the matching coins went in as locked liquidity; the rest of the unsold supply was burned. Pool fees go to Counsel rewards.{UNISWAP_URL && <> <a className="ext" href={UNISWAP_URL} target="_blank" rel="noreferrer">Trade on Uniswap</a></>}</>
            ) : grad ? (
              <>At <strong>{units(grad.threshold, 18, 0)} $COMD</strong> in the reserve ({grad.threshold > 0n ? `${Math.min(100, Number((grad.reserve * 1000n) / grad.threshold) / 10).toFixed(1)}%` : "—"} there) the coin graduates into a Uniswap v4 pool paired with $COMD — in the same transaction as the buy that gets it there. The curve then closes and the pool takes over at the same price.</>
            ) : (
              <span className="muted">At a $COMD threshold the coin graduates into a Uniswap v4 pool paired with $COMD.</span>
            )}
          </dd>
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
        {grad?.done ? (
          <div className="card" style={{ display: "grid", gap: 12 }}>
            <span className="badge ok fill">Graduated</span>
            <p style={{ margin: 0 }}>The curve is closed: <strong>${info?.symbol ?? "this coin"}</strong> trades on Uniswap v4 against $COMD.</p>
            {UNISWAP_URL ? <a className="btn gold" href={UNISWAP_URL} target="_blank" rel="noreferrer">Trade on Uniswap</a> : <span className="small muted">Open the pool in any Uniswap v4 interface on Robinhood Chain.</span>}
            <a className="small ext" href={explorerUrl("address", inc.address ?? address)} target="_blank" rel="noreferrer">Pool details on the explorer</a>
          </div>
        ) : (
        <div className="card" style={{ display: "grid", gap: 14 }}>
          <div className="seg" role="group" aria-label="Buy or sell">
            <button type="button" aria-pressed={side === "buy"} onClick={() => setSide("buy")}>Buy</button>
            <button type="button" aria-pressed={side === "sell"} onClick={() => setSide("sell")}>Sell</button>
          </div>
          <div className="seg" role="group" aria-label={side === "buy" ? "Pay with" : "Receive"}>
            <button type="button" aria-pressed={via === "comd"} onClick={() => setVia("comd")}>{side === "buy" ? "Pay COMD" : "Get COMD"}</button>
            <button type="button" aria-pressed={via === "eth"} disabled={!ethEnabled} title={ethEnabled ? undefined : "ETH trading opens once the $COMD pool is configured after graduation on Pons"} onClick={() => setVia("eth")}>{side === "buy" ? "Pay ETH" : "Get ETH"}</button>
          </div>
          {!ethEnabled && <span className="small muted">COMD only for now: ETH trading opens after $COMD graduates on Pons and the pool is configured. <a href={PONS_URL} target="_blank" rel="noreferrer">Get $COMD on Pons</a></span>}
          {!grad?.done && (
            <span className="small muted">
              Until it graduates, this coin trades only here, on its curve. Trackers such as gmgn or DEX Screener look
              for a DEX pool, so they show no liquidity and cannot buy it; the coin/$COMD pool on Uniswap v4 opens at graduation.
            </span>
          )}
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
        )}
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
