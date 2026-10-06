"use client";
import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useSendTransaction, useSignTypedData, useSwitchChain } from "wagmi";
import { decodeEventLog, type Address, type Hex } from "viem";
import { abiOf } from "@/lib/contracts";
import { activeChain } from "@/lib/chains";
import { counselName, short } from "@/lib/format";
import { ConnectButton } from "./ConnectButton";

type PairState = { code: string; consumed: boolean; enrolled: boolean; wallet: string | null; tokenId: string | null; agentId: string | null; deviceKey: string; nonce: string; expiresAt: string | number; relayOrigin: string; chainId: number };
/** GET /pair/wallet/:address `seats[]` (API shape; `devices` is the older shape). */
type SeatRow = { tokenId: string; agentId: string | null; registered: boolean; enrolled?: boolean; deviceKey?: string | null; online?: boolean; devices?: { deviceKey: string; status: string }[] };
const hasDevice = (s: SeatRow) => !!(s.enrolled || s.deviceKey || (s.devices?.length ?? 0) > 0);

const hex32 = (h: string) => (h.startsWith("0x") ? h : `0x${h}`) as Hex;

function Step({ n, title, done, children }: { n: string; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <div className="section" style={{ margin: "22px 0" }}>
      <div className="section-title"><span className="num">{n}</span><h2 style={{ fontSize: 13 }}>{title}</h2>{done && <span className="badge ok">Done</span>}</div>
      {children}
    </div>
  );
}

export function Pair({ initialCode }: { initialCode: string }) {
  const [code, setCode] = useState(initialCode);
  const [st, setSt] = useState<PairState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [seats, setSeats] = useState<SeatRow[] | null>(null);
  const [tokenId, setTokenId] = useState("");
  const [agentId, setAgentId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "registering" | "signing" | "done">("idle");
  const { address, chainId } = useAccount();
  const client = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();

  const look = async (c = code) => {
    setErr(null);
    setSt(null);
    const r = await fetch(`/api/pair/${encodeURIComponent(c.trim())}`);
    const j = await r.json();
    if (!r.ok) return setErr(j.error ?? "unknown code");
    setSt(j);
  };
  useEffect(() => {
    if (initialCode) look(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!address) return;
    fetch(`/api/pair/wallet/${address}`).then((r) => r.json()).then((j) => {
      setSeats(j.seats ?? []);
      if (j.seats?.[0]) { setTokenId(j.seats[0].tokenId); setAgentId(j.seats[0].agentId); }
    }).catch(() => setSeats([]));
  }, [address]);

  const seat = seats?.find((s) => s.tokenId === tokenId);
  const registered = !!(agentId ?? seat?.agentId);

  const ensureChain = async () => { if (chainId !== activeChain.id) await switchChainAsync({ chainId: activeChain.id }); };

  const register = async () => {
    setErr(null);
    setPhase("registering");
    try {
      await ensureChain();
      const intent = await (await fetch(`/api/agents/register-intent?tokenId=${tokenId}`)).json();
      const hash = await sendTransactionAsync({ to: intent.to as Address, data: intent.data as Hex, chainId: intent.chainId });
      await fetch("/api/agents/bind", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokenId, pending: true }) });
      const rc = await client!.waitForTransactionReceipt({ hash });
      let id: string | null = null;
      for (const log of rc.logs) {
        try {
          const ev = decodeEventLog({ abi: abiOf("IdentityRegistry"), data: log.data, topics: log.topics }) as unknown as { eventName: string; args: Record<string, unknown> };
          if (ev.eventName === "Registered") id = String(ev.args.agentId);
          else if (ev.eventName === "Transfer" && !id) id = String(ev.args.tokenId);
        } catch {}
      }
      if (!id) throw new Error("registration mined but no agent id found in the receipt");
      await fetch("/api/agents/bind", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokenId, agentId: id }) });
      setAgentId(id);
      setPhase("idle");
    } catch (e) {
      setErr((e as Error).message.split("\n")[0]);
      setPhase("idle");
    }
  };

  const bind = async () => {
    if (!st || !address) return;
    setErr(null);
    setPhase("signing");
    try {
      await ensureChain();
      const expiresAt = BigInt(typeof st.expiresAt === "number" ? st.expiresAt : Math.floor(Date.parse(st.expiresAt) / 1000));
      const message = { deviceKey: hex32(st.deviceKey), wallet: address.toLowerCase() as Address, tokenId: BigInt(tokenId), nonce: hex32(st.nonce), expiresAt, relayOrigin: st.relayOrigin };
      const signature = await signTypedDataAsync({
        domain: { name: "Company.md Worker", version: "1", chainId: st.chainId ?? activeChain.id },
        primaryType: "WorkerAuthorization",
        types: { WorkerAuthorization: [{ name: "deviceKey", type: "bytes32" }, { name: "wallet", type: "address" }, { name: "tokenId", type: "uint256" }, { name: "nonce", type: "bytes32" }, { name: "expiresAt", type: "uint64" }, { name: "relayOrigin", type: "string" }] },
        message,
      });
      const r = await fetch("/api/pair/complete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: st.code ?? code, message: { deviceKey: st.deviceKey.replace(/^0x/, ""), wallet: address.toLowerCase(), tokenId, nonce: st.nonce.replace(/^0x/, ""), expiresAt: Number(expiresAt), relayOrigin: st.relayOrigin }, signature }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `http ${r.status}`);
      setPhase("done");
    } catch (e) {
      setErr((e as Error).message.split("\n")[0]);
      setPhase("idle");
    }
  };


  if (phase === "done") return (
    <div className="notice good stack"><span className="px ok" style={{ fontSize: 14 }}>Seated.</span><p style={{ margin: 0 }}>{counselName(tokenId)} is bound to this machine. Go back to your terminal; <span className="mono">comd start</span> picks it up within a few seconds.</p></div>
  );

  return (
    <div style={{ maxWidth: 680 }}>
      <Step n="01" title="Enter the code from your terminal" done={!!st}>
        <form className="row" onSubmit={(e) => { e.preventDefault(); look(); }}>
          <label className="sr-only" htmlFor="code">Pairing code</label>
          <input id="code" className="mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="K7Q2-M9" maxLength={16} style={{ width: 200, fontSize: 18, letterSpacing: "0.1em" }} />
          <button className="btn" type="submit" disabled={code.trim().length < 4}>Look up</button>
        </form>
        {st && <p className="small muted" style={{ marginTop: 8 }}>Device <span className="mono">{short(st.deviceKey, 10, 6)}</span> · expires {new Date(typeof st.expiresAt === "number" ? st.expiresAt * 1000 : st.expiresAt).toUTCString()}{st.consumed && <span className="bad"> · already used</span>}</p>}
        {!st && <p className="small muted" style={{ marginTop: 8 }}>Run <span className="mono">comd start</span>; on first run it prints a code and this page&apos;s address.</p>}
      </Step>
      <Step n="02" title="Connect the wallet that holds the seat" done={!!address}>
        {address ? <p className="small">Connected <span className="mono">{short(address)}</span></p> : <ConnectButton className="btn" />}
      </Step>
      <Step n="03" title="Choose the seat" done={!!tokenId}>
        {address && seats && seats.length > 0 ? (
          <div className="row" role="radiogroup" aria-label="Your seats">
            {seats.map((s) => (
              <button key={s.tokenId} type="button" role="radio" aria-checked={tokenId === s.tokenId} className={`tile ${tokenId === s.tokenId ? "on" : ""}`} style={{ padding: "8px 12px" }} onClick={() => { setTokenId(s.tokenId); setAgentId(s.agentId); }}>
                {counselName(s.tokenId)} <span className="muted" style={{ textTransform: "none" }}>{s.registered ? `agent ${s.agentId}` : "unregistered"}{hasDevice(s) ? ` · ${s.online ? "online" : "device bound"}` : ""}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="row">
            <label className="label" htmlFor="tid">Token id</label>
            <input id="tid" type="number" min={0} max={1999} value={tokenId} onChange={(e) => setTokenId(e.target.value)} style={{ width: 120 }} disabled={!address} />
            {address && seats?.length === 0 && <span className="small muted">No seats found for this wallet. <a href="/mint">Mint one</a>.</span>}
          </div>
        )}
        {seat && hasDevice(seat) && <p className="small muted">This seat already has a device; binding this one replaces it (one active device per seat).</p>}
      </Step>
      <Step n="04" title="Register the agent (ERC-8004)" done={registered}>
        {registered ? <p className="small">Registered as agent <span className="mono">{agentId ?? seat?.agentId}</span>.</p> : (
          <>
            <p className="small muted">An unregistered seat cannot connect. This sends IdentityRegistry.register(agentURI) from your wallet once; the URI points to the seat&apos;s registration document.</p>
            <button className="btn" type="button" disabled={!address || !tokenId || phase !== "idle"} onClick={register}>{phase === "registering" ? "Registering…" : "Register agent"}</button>
          </>
        )}
      </Step>
      <Step n="05" title="Sign and bind">
        <p className="small muted">Signs a WorkerAuthorization (EIP-712, no gas) that lets this device work for {tokenId ? counselName(tokenId) : "the seat"} until you unlink it.</p>
        <button className="btn primary" type="button" disabled={!st || st.consumed || !address || !tokenId || !registered || phase !== "idle"} onClick={bind}>{phase === "signing" ? "Sign in wallet…" : "Sign and bind"}</button>
      </Step>
      {err && <p className="err-text small" role="alert">{err}</p>}
    </div>
  );
}
