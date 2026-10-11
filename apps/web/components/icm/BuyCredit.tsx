"use client";
// Buying credit from the page, instead of being handed an address and told to go and do a transfer.
//
// Two ways in, and the second is the point of the thing:
//
//   $COMD  one `transfer` to the desk. Works whenever the desk has an address, with no pool and no router.
//   ETH    one `swapExactETHForComd` through the buyback swapper, with the desk as the recipient, so paying in
//          ETH is a single transaction rather than swap-then-send.
//
// The ETH route needs the pool the swapper points at to exist, which happens when $COMD graduates. Until then
// the tab says so and sends people to the launchpad, rather than offering a button that reverts.
//
// On attribution: a swap arrives at the desk *from the pool*, not from the buyer, so the control plane credits
// the wallet that signed the transaction for transfers out of known forwarders (apps/api/src/icm.ts). That is
// why this calls the swapper directly rather than through any router of the day: the swapper is the contract
// the desk has been told to trust.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useBalance, useChainId, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { formatUnits, parseEther, parseUnits, type Abi, type Address } from "viem";
import { ConnectButton } from "@/components/ConnectButton";
import { addressOf, abiOf } from "@/lib/contracts";
import { activeChain, explorerUrl } from "@/lib/chains";

type Pay = "token" | "eth";

/** How far the quote may move before the swap gives up, in basis points of the quote. */
const SLIPPAGE_BPS = 50n;
/** A swap has to land in a sensible number of blocks or be dropped rather than filled at some later price. */
const DEADLINE_SECONDS = 600n;

const ERC20_TRANSFER = [{
  type: "function", name: "transfer", stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
}] as const satisfies Abi;

export type BuyDeposit = {
  address: string | null;
  token?: string;
  symbol?: string;
  decimals?: number;
  chainId?: number;
  tokensPerUsd?: string;
  minimumTokens?: string;
  paymentIsBurn?: boolean;
  /** True when buying destroys the token, by either route: a burn address, or the host burning what lands. */
  burns?: boolean;
};

/** Trim a float string to what the token can actually represent, so parseUnits never throws on a long decimal. */
function clampDecimals(v: string, decimals: number) {
  const [i, f] = v.split(".");
  return f === undefined ? i : `${i}.${f.slice(0, decimals)}`;
}

export function BuyCredit({ deposit, onDone }: { deposit: BuyDeposit; onDone?: () => void }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const client = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [pay, setPay] = useState<Pay>("token");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<bigint | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [poolLive, setPoolLive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const swapper = addressOf("Swapper") as Address | undefined;
  const token = (deposit.token || addressOf("ComdToken")) as Address | undefined;
  const desk = deposit.address as Address | null;
  const symbol = deposit.symbol ?? "COMD";
  const decimals = deposit.decimals ?? 18;
  const wrongChain = isConnected && chainId !== activeChain.id;

  const tokenBal = useBalance({ address, token, query: { enabled: !!address && !!token } });
  const ethBal = useBalance({ address, query: { enabled: !!address } });
  const have = pay === "eth" ? ethBal.data : tokenBal.data;

  // Does the swapper have a pool yet? It is the difference between an ETH tab that works and one that reverts,
  // so it is read from the chain rather than assumed from a link being set somewhere.
  useEffect(() => {
    let alive = true;
    if (!client || !swapper) { setPoolLive(false); return; }
    client.readContract({ address: swapper, abi: abiOf("Swapper") as Abi, functionName: "configured" })
      .then((v) => alive && setPoolLive(Boolean(v)))
      .catch(() => alive && setPoolLive(false));
    return () => { alive = false; };
  }, [client, swapper]);

  /** What the typed amount is worth in credit, in dollars, or null while it cannot be known. */
  const credit = useMemo(() => {
    const perUsd = Number(deposit.tokensPerUsd ?? 0);
    if (!perUsd) return null;
    if (pay === "token") {
      const n = Number(amount);
      return Number.isFinite(n) && n > 0 ? n / perUsd : null;
    }
    if (quote === null) return null;
    return Number(formatUnits(quote, decimals)) / perUsd;
  }, [amount, pay, quote, deposit.tokensPerUsd, decimals]);

  // Quote an ETH amount against the pool. The quoter is non-view by design (it simulates the swap and reverts
  // with the answer), so it is a simulate, not a read, and it is debounced because it is a round trip per keystroke.
  useEffect(() => {
    if (pay !== "eth" || !client || !swapper || !poolLive) { setQuote(null); return; }
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) { setQuote(null); return; }
    let alive = true;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const { result } = await client.simulateContract({
          address: swapper, abi: abiOf("Swapper") as Abi, functionName: "quoteETHForComd",
          args: [parseEther(clampDecimals(amount, 18))],
        });
        if (alive) setQuote(result as bigint);
      } catch {
        if (alive) setQuote(null);
      } finally {
        if (alive) setQuoting(false);
      }
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [amount, pay, client, swapper, poolLive]);

  const setMax = () => {
    if (!have) return;
    // ETH has to pay for its own gas, so offering the whole balance as "max" offers a transaction that cannot
    // be sent. A tenth of an ETH-cent is a generous floor on any L2 and keeps the number tidy.
    const raw = pay === "eth" ? (have.value > parseEther("0.0005") ? have.value - parseEther("0.0005") : 0n) : have.value;
    setAmount(formatUnits(raw, have.decimals));
  };

  const run = useCallback(async (what: string, fn: () => Promise<`0x${string}`>) => {
    setBusy(what); setErr(null); setSent(null);
    try {
      if (wrongChain) await switchChainAsync({ chainId: activeChain.id });
      const hash = await fn();
      setSent(hash);
      setAmount("");
      onDone?.();
    } catch (e) {
      const m = (e as Error).message ?? "";
      setErr(
        /User rejected|denied|rejected the request/i.test(m) ? "You cancelled it, so nothing was sent."
        : /insufficient funds/i.test(m) ? "Not enough in the wallet to cover the amount and the gas."
        : /Slippage/i.test(m) ? "The price moved more than the slippage allowed, so the swap was not made. Try again."
        : /PoolNotSet/i.test(m) ? "There is no pool to swap through yet."
        : m.split("\n")[0] || "That did not go through.",
      );
    } finally { setBusy(null); }
  }, [wrongChain, switchChainAsync, onDone]);

  const sendToken = () => run("token", async () => {
    if (!token || !desk) throw new Error("There is nowhere to send to yet.");
    return writeContractAsync({
      address: token, abi: ERC20_TRANSFER, functionName: "transfer",
      args: [desk, parseUnits(clampDecimals(amount, decimals), decimals)],
      chainId: activeChain.id,
    });
  });

  const swapEth = () => run("eth", async () => {
    if (!swapper || !desk) throw new Error("There is nowhere to send to yet.");
    if (quote === null) throw new Error("No price for that amount yet. Give the quote a moment.");
    const minOut = (quote * (10_000n - SLIPPAGE_BPS)) / 10_000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + DEADLINE_SECONDS;
    return writeContractAsync({
      address: swapper, abi: abiOf("Swapper") as Abi, functionName: "swapExactETHForComd",
      args: [minOut, desk, deadline],
      value: parseEther(clampDecimals(amount, 18)),
      chainId: activeChain.id,
    });
  });

  const n = Number(amount);
  const amountOk = Number.isFinite(n) && n > 0;
  const enough = !have || !amountOk ? true : (() => {
    try { return parseUnits(clampDecimals(amount, have.decimals), have.decimals) <= have.value; } catch { return true; }
  })();
  const canBuy = amountOk && enough && !!desk && busy === null && (pay === "token" || (poolLive === true && quote !== null));

  if (!desk) return null;

  return (
    <div className="buy">
      <div className="buy-head">
        <h3>Buy credit</h3>
        <span className={deposit.burns ? "buy-sub buy-burn" : "buy-sub"}>{deposit.burns ? `Burns ${symbol}` : `Paid to the desk`}</span>
      </div>

      <div className="buy-tabs" role="tablist" aria-label="What to pay with">
        <button type="button" role="tab" aria-selected={pay === "token"} className={pay === "token" ? "on" : ""}
          onClick={() => { setPay("token"); setAmount(""); setErr(null); }}>${symbol}</button>
        <button type="button" role="tab" aria-selected={pay === "eth"} className={pay === "eth" ? "on" : ""}
          onClick={() => { setPay("eth"); setAmount(""); setErr(null); }}>ETH</button>
      </div>

      <div className="buy-field">
        <span className="buy-label">You pay</span>
        <div className="buy-row">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"))}
            placeholder="0" inputMode="decimal" aria-label={`Amount of ${pay === "eth" ? "ETH" : symbol}`}
          />
          <span className="buy-unit">{pay === "eth" ? "ETH" : symbol}</span>
        </div>
        <div className="buy-under">
          <span>
            Balance {have ? Number(formatUnits(have.value, have.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 }) : "0"}
          </span>
          {have && have.value > 0n && <button type="button" className="buy-max" onClick={setMax}>Max</button>}
        </div>
      </div>

      <div className="buy-field buy-get">
        <span className="buy-label">You get</span>
        <div className="buy-row">
          <b>{quoting ? "…" : credit !== null ? `$${credit.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : "—"}</b>
          <span className="buy-unit">credit</span>
        </div>
        {pay === "eth" && quote !== null && (
          <div className="buy-under">
            <span>routed to {Number(formatUnits(quote, decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol}</span>
          </div>
        )}
      </div>

      {!isConnected ? (
        <ConnectButton className="btn primary buy-go" label="Connect a wallet" />
      ) : pay === "eth" && poolLive === false ? (
        <div className="buy-note">
          <p>
            Paying in ETH needs the ${symbol} pool, which opens when it graduates on the launchpad. Until then buy
            ${symbol} there and pay with the ${symbol} tab.
          </p>
          <a className="btn sm" href="/swap">Where to buy ${symbol}</a>
        </div>
      ) : (
        <button type="button" className="btn primary buy-go" onClick={pay === "eth" ? swapEth : sendToken} disabled={!canBuy}>
          {busy ? "Check your wallet…"
            : wrongChain ? "Switch network and buy"
            : !amountOk ? "Buy credit"
            : !enough ? `Not enough ${pay === "eth" ? "ETH" : symbol}`
            : "Buy credit"}
        </button>
      )}

      {err && <p className="buy-err">{err}</p>}
      {sent && (
        <p className="buy-ok">
          Sent. Credit appears on your account once it has confirmed.{" "}
          <a className="ext" href={explorerUrl("tx", sent)} target="_blank" rel="noreferrer">View the transaction</a>
        </p>
      )}

      <p className="buy-foot">
        {pay === "eth"
          ? `Routed by the pool, ${Number(SLIPPAGE_BPS) / 100}% slippage. The credit lands on the wallet that signed, not on the pool.`
          : `Sent straight to the desk. The credit lands on the wallet it came from.`}
        {deposit.burns && ` Every ${symbol} spent here is destroyed, so buying inference takes supply off the market for good.`}
      </p>
    </div>
  );
}
