"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useReadContracts, useWalletClient, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from "wagmi";
import { erc20Abi, type Address } from "viem";
import type { Capabilities, CheckResult, RequestStatus } from "@/lib/types";
import * as paid from "@/lib/paid";
import { addressOf } from "@/lib/contracts";
import { activeChain } from "@/lib/chains";
import { APPROVAL_REQUESTS, DEFAULT_PRICE } from "@/lib/config";
import { comd } from "@/lib/format";
import { ConnectButton } from "../ConnectButton";
import { OracleFields, defaultOracle, oracleBody, type OracleState } from "./OracleFields";
import { celebrate, gavelSlam } from "@/lib/fx";
import { RStamp, WaxSvg } from "../fx/Stamps";
import { CaseField } from "../CaseField";

type Choice = "company" | "oracle" | "retainer" | "topup" | "token" | "contracts" | "hook" | "audit" | "report" | "website" | "image" | "audio" | "video";

const MODES: { key: Choice; title: string; sub: string; icon: string }[] = [
  { key: "company", title: "Incorporate a company", sub: "Contracts, token and site", icon: "company" },
  { key: "oracle", title: "Request a ruling", sub: "A signed answer", icon: "oracle" },
  { key: "retainer", title: "Retainer", sub: "Work on a schedule", icon: "heartbeat" },
];
const TILES: { key: Choice; label: string; icon: string }[] = [
  { key: "token", label: "Token", icon: "token" },
  { key: "contracts", label: "Contracts", icon: "contracts" },
  { key: "hook", label: "v4 hook", icon: "hook" },
  { key: "audit", label: "Audit", icon: "audit" },
  { key: "report", label: "Report", icon: "report" },
  { key: "website", label: "Website", icon: "website" },
  { key: "image", label: "Image", icon: "image" },
  { key: "audio", label: "Audio", icon: "audio" },
  { key: "video", label: "Video", icon: "video" },
];

const DESCRIBE: Record<string, { lead: string; rest: string; placeholder: string; note?: string }> = {
  company: { lead: "What the company does: its contracts, its token's name and symbol, and what its website shows. The token's supply is the incorporation's; you choose its pool share below.", rest: " Be specific: counsel build exactly what you write.", placeholder: "A staking vault for an ERC-20 that pays stakers a share of fees, and a site showing the APR and a connected wallet's position.", note: "The website is built against the live contracts and hosted on Company.md's sites." },
  token: { lead: "The token: its name, symbol and anything it does beyond a plain ERC-20.", rest: " Supply is fixed by policy (1,000,000,000); you choose the pool share.", placeholder: "BRIEF (BRF): a plain fixed-supply ERC-20 with permit. No owner, no mint, no fees." },
  contracts: { lead: "The contracts, what each does and who may call what.", rest: " Contracts only: no token and no pool. Tests and the audit panel run before anything deploys.", placeholder: "A timelock escrow that releases COMD to a beneficiary after a cliff, with a pause the owner can renounce." },
  hook: { lead: "The Uniswap v4 hook: which callbacks, what it charges or does, and where value goes.", rest: " The Bench (four justices and the chief justice) reviews it before deployment.", placeholder: "A hook that takes 0.3% of every sell and routes it to a staking vault; buys are untouched." },
  audit: { lead: "What to audit and what you are worried about.", rest: " Import the repository first; the Bench audits the commit you pin.", placeholder: "Audit the bonding curve and fee routing in src/Curve.sol and src/FeeSplitter.sol. Focus on rounding and reentrancy." },
  report: { lead: "The question the report answers, what it must contain and what it may not rest on.", rest: " Counsel cite their sources.", placeholder: "Which stablecoins are natively issued on Robinhood Chain, who issues each, and what attestation cadence each publishes? One row per asset." },
  website: { lead: "What the site shows and does, page by page.", rest: " It is built, checked and hosted under a name you choose.", placeholder: "A one-page site listing every Counsel seat's accepted work this week, grouped by practice, with a search box." },
  image: { lead: "The image: subject, composition, palette, size.", rest: "", placeholder: "A 1024×1024 pixel-art wax seal on black: brass ring, a quill crossed over a key, no text." },
  audio: { lead: "The sound: length, mood, instruments, format.", rest: "", placeholder: "A 20-second 8-bit fanfare for a verdict: four bars, square-wave lead, triangle bass, WAV." },
  video: { lead: "The video: length, shots, text on screen, aspect ratio.", rest: "", placeholder: "A 15-second 16:9 teaser: a pixel courtroom, the gavel strikes, the docket scrolls, a wax seal stamps a ruling." },
};

const PAY_LINE: Record<string, string> = {
  company: "You get the contracts and token live on {chain}, and the website on Company.md's sites. Source on GitHub.",
  token: "You get the token live on {chain} with its pool opened. Source on GitHub.",
  contracts: "You get the contracts deployed on {chain}, after tests and the audit panel. Source on GitHub.",
  hook: "You get the hook and its pool live on {chain}, after the audit panel. Source on GitHub.",
  audit: "You get an audit report from the Bench: four justices and the chief justice's ruling on every finding.",
  report: "You get a cited report, cross-examined before it is filed.",
  website: "You get the site built, checked and hosted on Company.md's sites. Source on GitHub.",
  image: "You get the image files, filed as exhibits.",
  audio: "You get the audio files, filed as exhibits.",
  video: "You get the video files, filed as exhibits.",
  oracle: "You get a signed answer (EIP-712) your contract can verify, once the panel agrees.",
  retainer: "You get one run per slot until the runs you buy are used. Unused runs are not refunded.",
  topup: "You add runs to an existing retainer at today's price per run.",
};

const EVERY = [
  ["PT10M", "10 minutes"],
  ["PT30M", "30 minutes"],
  ["PT1H", "hour"],
  ["PT4H", "4 hours"],
  ["PT6H", "6 hours"],
  ["P1D", "day"],
  ["P1W", "week"],
] as const;
const TZS = ["UTC", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Lisbon", "Europe/Berlin", "Asia/Singapore", "Asia/Tokyo"];

type Step = "idle" | "quote" | "challenge" | "sign" | "submit" | "poll" | "done" | "error";
const STEPS: { k: Step; label: string }[] = [
  { k: "quote", label: "Quote" },
  { k: "challenge", label: "402 challenge" },
  { k: "sign", label: "Sign payment + approval" },
  { k: "submit", label: "Submit" },
  { k: "poll", label: "Admission" },
];

export function RetainFlow({ icons, caps, initial, scheduleId }: { icons: Record<string, string>; caps: Capabilities | null; initial?: string; scheduleId?: string }) {
  const start = (["company", "oracle", "retainer", "topup", ...TILES.map((t) => t.key)] as string[]).includes(initial ?? "") ? (initial as Choice) : "company";
  const [choice, setChoice] = useState<Choice>(start);
  const [text, setText] = useState("");
  const chains = caps?.launches.chains ?? [{ chainId: activeChain.id, name: activeChain.name, testnet: !!activeChain.testnet, kinds: ["custom_token", "evm_project", "univ4_hook", "evm_contracts"], pairings: [] }];
  const [chainId, setChainId] = useState<number>(caps?.launches.defaultChainId ?? activeChain.id);
  const [poolPct, setPoolPct] = useState(88);
  const [siteLabel, setSiteLabel] = useState("");
  const [repo, setRepo] = useState({ url: "", ref: "", commit: "", status: "" });
  const [oracle, setOracleState] = useState<OracleState>(() => defaultOracle(activeChain.id));
  const setOracle = (p: Partial<OracleState>) => setOracleState((s) => ({ ...s, ...p }));
  const [ret, setRet] = useState({ what: "oracle" as "oracle" | "job", cadence: "every" as "every" | "cron", every: "P1D", cron: "0 9 * * *", tz: "UTC", runs: 30, label: "", cont: false, startAt: "", skill: "research-report" });
  const [topup, setTopup] = useState({ scheduleId: scheduleId ?? "", runs: 30 });
  const [checked, setChecked] = useState<{ key: string; res: CheckResult } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkErr, setCheckErr] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [payErr, setPayErr] = useState<string | null>(null);
  const [order, setOrder] = useState<RequestStatus | null>(null);

  const { address, chainId: walletChain } = useAccount();
  const { data: wallet } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();

  // ------------------------------------------------ payment terms
  const capFor = (a: string) => caps?.actions.find((x) => x.action === a);
  const action = choice === "oracle" ? "oracle.request" : choice === "retainer" ? "schedule.create" : choice === "topup" ? "schedule.topup" : ["company", "token", "contracts", "hook"].includes(choice) ? "launch.open" : "job.open";
  const cap = capFor(action) ?? caps?.actions[0];
  const unit = BigInt(cap?.payment.amount ?? DEFAULT_PRICE);
  const runs = choice === "retainer" ? ret.runs : choice === "topup" ? topup.runs : 1;
  const price = unit * BigInt(Math.max(1, runs || 1));
  const asset = (cap?.payment.asset as Address | undefined) ?? addressOf("ComdToken");
  const permit2 = addressOf("Permit2") ?? ("0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address);
  const approveAmount = unit * APPROVAL_REQUESTS;

  const reads = useReadContracts({
    contracts: asset && address ? [
      { address: asset, abi: erc20Abi, functionName: "balanceOf", args: [address] },
      { address: asset, abi: erc20Abi, functionName: "allowance", args: [address, permit2] },
    ] : [],
    query: { enabled: !!asset && !!address, refetchInterval: 15_000 },
  });
  const balance = (reads.data?.[0]?.result as bigint | undefined) ?? (address ? 0n : undefined);
  const allowance = (reads.data?.[1]?.result as bigint | undefined) ?? (address ? 0n : undefined);
  const { writeContractAsync, data: approveTx, isPending: approving } = useWriteContract();
  const approveRcpt = useWaitForTransactionReceipt({ hash: approveTx });
  useEffect(() => {
    if (approveRcpt.isSuccess) reads.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveRcpt.isSuccess]);
  const needsApproval = !address || allowance === undefined || allowance < price;

  // ------------------------------------------------ input
  const input = useMemo(() => {
    const economics = { poolBps: poolPct * 100, ...(address ? { remainderTo: address.toLowerCase() } : {}) };
    switch (choice) {
      case "company":
        return { objective: text.trim(), onchain: "custom_token", chainId, economics, github: true, ipfs: siteLabel.trim() || true };
      case "token":
        return { objective: text.trim(), onchain: "custom_token", chainId, economics, github: true };
      case "contracts":
        return { objective: text.trim(), onchain: "evm_contracts", chainId, github: true, ...(address ? { owner: address.toLowerCase() } : {}) };
      case "hook":
        return { objective: text.trim(), onchain: "univ4_hook", chainId, economics, github: true };
      case "audit":
        return { objective: text.trim(), template: "audit", repoUrl: repo.url.trim(), ...(repo.commit ? { baseCommit: repo.commit } : {}) };
      case "report":
        return { objective: text.trim(), skill: "research-report", outputs: [{ name: "report", path: "artifacts/report.md", mediaType: "text/markdown" }], github: false };
      case "website":
        return { objective: text.trim(), skill: "build-website", ipfs: siteLabel.trim() || true, github: true };
      case "image":
        return { objective: text.trim(), skill: "create-image", outputs: [{ name: "image", path: "artifacts/image.png", mediaType: "image/png" }], github: false };
      case "audio":
        return { objective: text.trim(), skill: "create-audio", outputs: [{ name: "audio", path: "artifacts/audio.wav", mediaType: "audio/wav" }], github: false };
      case "video":
        return { objective: text.trim(), skill: "create-video", outputs: [{ name: "video", path: "artifacts/video.mp4", mediaType: "video/mp4" }], github: false };
      case "oracle":
        return oracleBody(oracle);
      case "retainer":
        return {
          action: ret.what === "oracle" ? "oracle.request" : "job.open",
          input: ret.what === "oracle" ? oracleBody(oracle) : { objective: text.trim(), skill: ret.skill, github: false },
          cadence: ret.cadence === "every" ? { every: ret.every } : { cron: ret.cron.trim(), tz: ret.tz },
          runs: ret.runs,
          ...(ret.label.trim() ? { label: ret.label.trim().slice(0, 120) } : {}),
          ...(ret.what === "job" && ret.cont ? { continue: true } : {}),
          ...(ret.startAt ? { startAt: new Date(ret.startAt).toISOString() } : {}),
        };
      case "topup":
        return { scheduleId: topup.scheduleId.trim(), runs: topup.runs };
    }
  }, [choice, text, chainId, poolPct, siteLabel, repo, oracle, ret, topup, address]);
  const inputKey = JSON.stringify([action, input]);
  const fresh = checked?.key === inputKey;
  const blockers = fresh ? checked!.res.blockers : [];
  const canPay = fresh && blockers.length === 0;

  const runCheck = async () => {
    setChecking(true);
    setCheckErr(null);
    try {
      const res = await paid.check(action, input);
      setChecked({ key: inputKey, res });
      if (res.blockers.length === 0) gavelSlam("Sustained");
      else gavelSlam("Overruled", "over");
      return res;
    } catch (e) {
      setCheckErr(e instanceof paid.PaidError ? `${e.code}${e.detail ? `: ${typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail)}` : ""}` : (e as Error).message);
      return null;
    } finally {
      setChecking(false);
    }
  };

  const importRepo = async () => {
    setRepo((r) => ({ ...r, status: "Importing…" }));
    try {
      const r = await fetch("/api/requests/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: repo.url.trim(), ...(repo.ref ? { ref: repo.ref } : {}), kind: "contracts" }) });
      const j = await r.json();
      if (j.ok) setRepo((x) => ({ ...x, commit: j.source.baseCommit, status: `Pinned ${j.source.baseCommit.slice(0, 10)} · ${j.source.sizeKb} KB` }));
      else setRepo((x) => ({ ...x, status: (j.problems ?? [j.error]).map((p: { message?: string } | string) => (typeof p === "string" ? p : p.message)).join("; ") }));
    } catch (e) {
      setRepo((x) => ({ ...x, status: (e as Error).message }));
    }
  };

  const pay = async () => {
    setPayErr(null);
    if (!fresh) {
      const res = await runCheck();
      if (!res || res.blockers.length) return;
    }
    if (!address || !wallet) return;
    try {
      if (walletChain !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
      setStep("quote");
      const q = await paid.quote(action, input);
      setStep("challenge");
      const ch = await paid.challenge(q.order.id);
      setStep("sign");
      const signed = await paid.sign(wallet, address, ch);
      setStep("submit");
      const first = await paid.submit(q.order.id, signed);
      setOrder(first);
      setStep("poll");
      const last = ["admitted", "payment_failed", "expired"].includes(first.status) ? first : await paid.poll(q.order.id, setOrder);
      setOrder(last);
      if (last.status === "admitted" && last.admission?.result.kind !== "refused") {
        setStep("done");
        celebrate("Admitted");
      }
      else {
        setStep("error");
        setPayErr(last.admission?.result.kind === "refused" ? `Refused: ${last.admission.result.problems.map((p) => p.message).join("; ")}` : `${last.status}${last.payment?.reason ? `: ${last.payment.reason}` : ""}`);
      }
    } catch (e) {
      setStep("error");
      const m = e instanceof paid.PaidError ? `${e.code}${e.detail ? `: ${typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail)}` : ""}` : (e as Error).message.split("\n")[0];
      setPayErr(m);
    }
  };

  const busy = !["idle", "done", "error"].includes(step);
  const chainLabel = chains.find((c) => c.chainId === chainId)?.name ?? activeChain.name;
  const isLaunch = ["company", "token", "hook"].includes(choice);
  const showChain = ["company", "token", "contracts", "hook"].includes(choice);
  const d = DESCRIBE[choice];
  const href = order ? paid.resultHref(order) : null;
  const lowBalance = address && balance !== undefined && balance < price;

  return (
    <div className="retain" style={{ maxWidth: 760 }}>
      {/* ---------------- approval */}
      <div className="section" style={{ marginTop: 8 }}>
        {needsApproval ? (
          <div className="stack" style={{ gap: 12 }}>
            <p style={{ margin: 0 }}>First, one approval. It lets Permit2 move up to {comd(approveAmount)} COMD, enough for ten requests, and costs gas once.</p>
            {address ? (
              <div className="row">
                <button
                  type="button"
                  className="btn"
                  disabled={!asset || approving || approveRcpt.isLoading}
                  onClick={async () => {
                    if (!asset) return;
                    try {
                      if (walletChain !== activeChain.id) await switchChainAsync({ chainId: activeChain.id });
                      await writeContractAsync({ address: asset, abi: erc20Abi, functionName: "approve", args: [permit2, approveAmount] });
                    } catch {}
                  }}
                >
                  {approving ? "Confirm in wallet…" : approveRcpt.isLoading ? "Approving…" : `Approve ${comd(approveAmount)} COMD`}
                </button>
                {!asset && <span className="small muted">COMD token address not configured.</span>}
                {approveRcpt.isError && <span className="small err-text">Approval failed.</span>}
              </div>
            ) : (
              <ConnectButton className="btn" label={`Connect to approve ${comd(approveAmount)} COMD`} />
            )}
          </div>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            <span className="ok">Approved.</span> Permit2 may move {comd(allowance)} COMD for you; each request is signed separately.
          </p>
        )}
      </div>

      {/* ---------------- 01 choose */}
      <div className="section">
        <div className="section-title"><span className="num">01</span><h2 style={{ fontSize: 13 }}>Choose</h2></div>
        <div className="grid g3" role="radiogroup" aria-label="What to retain the firm for" style={{ gap: 0 }}>
          {MODES.map((m) => {
            const on = choice === m.key || (m.key === "retainer" && choice === "topup");
            return (
              <button key={m.key} type="button" role="radio" aria-checked={on} className={`choice ${on ? "on" : ""}`} onClick={() => setChoice(m.key)}>
                <span className="choice-ico" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons[m.icon] ?? "" }} />
                <span className="choice-t">{m.title}</span>
                <span className="choice-s">{m.sub}</span>
              </button>
            );
          })}
        </div>
        <div className="tiles" role="radiogroup" aria-label="Or one deliverable">
          {TILES.map((t) => (
            <button key={t.key} type="button" role="radio" aria-checked={choice === t.key} className={`tile ${choice === t.key ? "on" : ""}`} onClick={() => setChoice(t.key)}>
              <span className="tile-ico" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons[t.icon] ?? "" }} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ---------------- 02 describe */}
      <div className="section">
        <div className="section-title"><span className="num">02</span><h2 style={{ fontSize: 13 }}>Describe</h2></div>
        {d && (
          <div className="stack" style={{ gap: 12 }}>
            <p style={{ margin: 0 }}><strong style={{ fontWeight: 500 }}>{d.lead}</strong><span className="muted">{d.rest}</span></p>
            {(choice === "audit") && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="row">
                  <label className="sr-only" htmlFor="repo">GitHub repository</label>
                  <input id="repo" className="grow" placeholder="https://github.com/owner/repo" value={repo.url} onChange={(e) => setRepo({ ...repo, url: e.target.value, commit: "", status: "" })} />
                  <label className="sr-only" htmlFor="ref">Branch or tag</label>
                  <input id="ref" placeholder="branch (optional)" value={repo.ref} onChange={(e) => setRepo({ ...repo, ref: e.target.value })} style={{ width: 160 }} />
                  <button type="button" className="btn sm" onClick={importRepo} disabled={!/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(repo.url)}>Import</button>
                </div>
                {repo.status && <span className="small muted">{repo.status}</span>}
              </div>
            )}
            <CaseField id="objective" value={text} onChange={setText} placeholder={d.placeholder} head="In re:" right={MODES.find((m) => m.key === choice)?.title ?? TILES.find((t) => t.key === choice)?.label ?? "Matter"} />
            {d.note && <p className="small muted" style={{ margin: 0 }}>{d.note}</p>}
            {(choice === "website" || choice === "company") && (
              <div className="inline-field">
                <label className="label" htmlFor="site">Site name</label>
                <div className="row" style={{ gap: 8 }}>
                  <input id="site" value={siteLabel} maxLength={32} onChange={(e) => setSiteLabel(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="docket" style={{ width: 180 }} />
                  <span className="small muted">.{process.env.NEXT_PUBLIC_SITES_DOMAIN || "sites.comd.fun"}</span>
                </div>
              </div>
            )}
            {showChain && (
              <div className="inline-field">
                <label className="label" htmlFor="chain">Chain</label>
                <select id="chain" value={chainId} onChange={(e) => setChainId(Number(e.target.value))} style={{ maxWidth: 280 }}>
                  {chains.map((c) => (
                    <option key={c.chainId} value={c.chainId} disabled={c.kinds.length === 0}>
                      {c.name}{c.kinds.length === 0 ? " (soon)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {isLaunch && (
              <>
                <div className="inline-field">
                  <label className="label" htmlFor="pool">Pool share</label>
                  <div className="row" style={{ gap: 10 }}>
                    <input id="pool" type="number" min={10} max={90} value={poolPct} onChange={(e) => setPoolPct(Math.max(10, Math.min(90, Math.round(Number(e.target.value) || 10))))} style={{ width: 80 }} aria-describedby="pool-hint" />
                    <span className="small muted" id="pool-hint">% of the supply · 10 to 90</span>
                  </div>
                </div>
                <p className="small muted" style={{ margin: 0 }} aria-live="polite">
                  10% goes to the swarm. The other 90% is yours: {poolPct}% opens the pool, and {90 - poolPct}% goes to the wallet that pays.
                </p>
              </>
            )}
          </div>
        )}
        {choice === "oracle" && (
          <div className="stack" style={{ gap: 12 }}>
            <p style={{ margin: 0 }}><strong style={{ fontWeight: 500 }}>A question about a chain or the world, put to a panel of counsel.</strong><span className="muted"> All {oracle.quorum} of a quorum must give the same answer before it is signed.</span></p>
            <OracleFields s={oracle} set={setOracle} minPanel={caps?.limits["oracle.request"]?.minPanelSize ?? 5} maxPanel={caps?.limits["oracle.request"]?.maxPanelSize ?? 100} />
          </div>
        )}
        {choice === "retainer" && (
          <div className="stack" style={{ gap: 14 }}>
            <p style={{ margin: 0 }}><strong style={{ fontWeight: 500 }}>A ruling or a matter, opened on a schedule.</strong><span className="muted"> Floors: 10 minutes between rulings, 30 between matters. Three failures in a row pause it; any top-up resumes it.</span></p>
            <div className="inline-field">
              <span className="label" id="ret-what">Each run</span>
              <div className="seg" role="group" aria-labelledby="ret-what">
                <button type="button" aria-pressed={ret.what === "oracle"} onClick={() => setRet({ ...ret, what: "oracle" })}>Requests a ruling</button>
                <button type="button" aria-pressed={ret.what === "job"} onClick={() => setRet({ ...ret, what: "job" })}>Opens a matter</button>
              </div>
            </div>
            <div className="inline-field">
              <span className="label" id="ret-cad">Cadence</span>
              <div className="row" style={{ gap: 8 }}>
                <div className="seg" role="group" aria-labelledby="ret-cad">
                  <button type="button" aria-pressed={ret.cadence === "every"} onClick={() => setRet({ ...ret, cadence: "every" })}>Every</button>
                  <button type="button" aria-pressed={ret.cadence === "cron"} onClick={() => setRet({ ...ret, cadence: "cron" })}>Cron</button>
                </div>
                {ret.cadence === "every" ? (
                  <select aria-label="Interval" value={ret.every} onChange={(e) => setRet({ ...ret, every: e.target.value })}>
                    {EVERY.filter(([v]) => ret.what === "oracle" || !["PT10M"].includes(v)).map(([v, l]) => (<option key={v} value={v}>every {l}</option>))}
                  </select>
                ) : (
                  <>
                    <input aria-label="Cron expression (five fields)" value={ret.cron} onChange={(e) => setRet({ ...ret, cron: e.target.value })} style={{ width: 150 }} className="mono" />
                    <select aria-label="Time zone" value={ret.tz} onChange={(e) => setRet({ ...ret, tz: e.target.value })}>{TZS.map((z) => <option key={z}>{z}</option>)}</select>
                  </>
                )}
              </div>
            </div>
            <div className="grid g3">
              <div className="field">
                <label htmlFor="runs">Runs (1–1,000,000)</label>
                <input id="runs" type="number" min={1} max={1000000} value={ret.runs} onChange={(e) => setRet({ ...ret, runs: Math.max(1, Math.min(1_000_000, Math.round(Number(e.target.value) || 1))) })} />
              </div>
              <div className="field">
                <label htmlFor="label">Label</label>
                <input id="label" maxLength={120} value={ret.label} onChange={(e) => setRet({ ...ret, label: e.target.value })} placeholder="daily burn ruling" />
              </div>
              <div className="field">
                <label htmlFor="startAt">Start (optional)</label>
                <input id="startAt" type="datetime-local" value={ret.startAt} onChange={(e) => setRet({ ...ret, startAt: e.target.value })} />
              </div>
            </div>
            {ret.what === "oracle" ? (
              <OracleFields s={oracle} set={setOracle} compact minPanel={caps?.limits["oracle.request"]?.minPanelSize ?? 5} maxPanel={caps?.limits["oracle.request"]?.maxPanelSize ?? 100} />
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                <CaseField id="ret-obj" value={text} onChange={setText} rows={5} tab="Standing instructions" head="Each run:" right="Retainer" hint="The same instructions, every run" placeholder="Update the report with what changed this week in Robinhood Chain DeFi: new pools, volume leaders, incidents." />
                <div className="row">
                  <label className="label" htmlFor="skill">Skill</label>
                  <select id="skill" value={ret.skill} onChange={(e) => setRet({ ...ret, skill: e.target.value })}>
                    {["research-report", "build-website", "create-image", "write-readme-and-docs"].map((s) => <option key={s}>{s}</option>)}
                  </select>
                  <label className="row small" style={{ gap: 6 }}>
                    <input type="checkbox" checked={ret.cont} onChange={(e) => setRet({ ...ret, cont: e.target.checked })} /> Continue from the last completed run
                  </label>
                </div>
              </div>
            )}
          </div>
        )}
        {choice === "topup" && (
          <div className="grid g2">
            <div className="field">
              <label htmlFor="sid">Retainer id</label>
              <input id="sid" value={topup.scheduleId} onChange={(e) => setTopup({ ...topup, scheduleId: e.target.value })} className="mono" placeholder="uuid" />
            </div>
            <div className="field">
              <label htmlFor="truns">Runs to add</label>
              <input id="truns" type="number" min={1} max={1000000} value={topup.runs} onChange={(e) => setTopup({ ...topup, runs: Math.max(1, Math.round(Number(e.target.value) || 1)) })} />
            </div>
          </div>
        )}
      </div>

      {/* ---------------- 03 check */}
      <div className="section">
        <div className="section-title"><span className="num">03</span><h2 style={{ fontSize: 13 }}>Check</h2></div>
        <p>The check reads the request the way the quote will: what the firm will do, what counsel know, and anything that would stop it. <span className="muted">Nothing is paid.</span></p>
        <button type="button" className="btn cyan" onClick={runCheck} disabled={checking}>{checking ? "Deliberating…" : fresh ? "Check again" : "Check"}</button>
        {checkErr && <p className="err-text small" role="alert">{checkErr}</p>}
        {fresh && <CheckView res={checked!.res} />}
        {checked && !fresh && <p className="small muted">The request changed since the last check.</p>}
      </div>

      {/* ---------------- 04 pay */}
      <div className="section">
        <div className="section-title"><span className="num">04</span><h2 style={{ fontSize: 13 }}>Pay</h2></div>
        <p>{(PAY_LINE[choice] ?? "").replace("{chain}", chainLabel)}</p>
        <p className="small muted">Price: <span style={{ color: "var(--text)" }}>{comd(price)} COMD</span>{runs > 1 ? ` (${comd(unit)} × ${runs} runs)` : ""}. Paid with one Permit2 signature and one quote approval; the firm pays the gas.</p>
        {step === "done" && href ? (
          <div className="notice good" role="status" style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
            <span className="seal big rv"><span className="wax"><WaxSvg /></span></span>
            <div className="stack" style={{ flex: 1, minWidth: 220 }}>
              <div><RStamp>Admitted</RStamp> <span className="muted">Paid, sealed and on the docket.</span></div>
              <Link className="btn primary lime" href={href}>Open it on the docket ›</Link>
            </div>
          </div>
        ) : !address ? (
          <ConnectButton className="btn" label="Connect to pay" />
        ) : (
          <button type="button" className={`btn lg ${canPay ? "primary" : "cyan"}`} onClick={pay} disabled={busy || checking || (fresh && blockers.length > 0) || (canPay && !!lowBalance)}>
            {busy ? "Working…" : canPay ? `Pay ${comd(price)} COMD` : "Check"}
          </button>
        )}
        <p className="small muted" style={{ marginTop: 10 }}>Checked first, then paid: nothing is asked of your wallet until the check passes.</p>
        {lowBalance && (
          <p className="small err-text" role="alert">
            You hold {comd(balance)} COMD, not enough for this request. <Link href="/swap">Buy COMD on the swap</Link>
          </p>
        )}
        {step !== "idle" && (
          <ol className="paysteps" aria-label="Payment progress">
            {STEPS.map((s, i) => {
              const idx = STEPS.findIndex((x) => x.k === step);
              const state = step === "done" ? "done" : step === "error" ? (i < Math.max(0, idx) ? "done" : "") : i < idx ? "done" : i === idx ? "now" : "";
              return (
                <li key={s.k} className={state}>
                  <span className="n">{String(i + 1).padStart(2, "0")}</span> {s.label}
                  {s.k === "poll" && order && <span className="muted small"> · {order.status}</span>}
                </li>
              );
            })}
          </ol>
        )}
        {payErr && <p className="err-text small" role="alert">{payErr}</p>}
      </div>
    </div>
  );
}

function CheckView({ res }: { res: CheckResult }) {
  return (
    <div className="stack" style={{ marginTop: 14 }}>
      {res.blockers.length === 0 ? (
        <div className="notice good split" style={{ justifyContent: "flex-start", gap: 16 }}><RStamp lg /><span>Nothing would stop this request.{res.judged?.summary ? ` ${res.judged.summary}` : ""}</span></div>
      ) : (
        <div className="notice err" role="alert">
          <RStamp kind="overruled" lg />
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{res.blockers.map((b, i) => <li key={i}>{b.message} <span className="mono small">({b.code})</span></li>)}</ul>
        </div>
      )}
      {res.suggestions.length > 0 && (
        <div className="notice warn">
          <span className="px tx-orange" style={{ fontSize: 11, fontWeight: 700 }}>Counsel suggests</span>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{res.suggestions.map((s, i) => <li key={i}>{s.message}</li>)}</ul>
        </div>
      )}
      {res.plan && (
        <div className="card">
          <div className="label" style={{ marginBottom: 8 }}>The plan{res.plan.shape ? ` · ${res.plan.shape}` : ""}{res.kind ? ` · ${res.kind}` : ""}</div>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {res.plan.steps.map((s, i) => (<li key={i}><span className="mono">{s.skill}</span>{s.role ? <span className="muted"> · {s.role}</span> : null}{s.why ? <span className="muted small"> — {s.why}</span> : null}</li>))}
          </ol>
          {(res.plan.references?.length ?? 0) > 0 && <p className="small muted" style={{ margin: "8px 0 0" }}>References: {res.plan.references!.join(", ")}</p>}
        </div>
      )}
      {res.project && (
        <div className="card"><div className="label">Project</div><p>{res.project.summary}</p></div>
      )}
      {res.request && (
        <details className="fold"><summary>The request as it will be quoted</summary><pre className="code inner" style={{ border: 0 }}>{JSON.stringify(res.request, null, 2)}</pre></details>
      )}
      {res.amount && (
        <div className="card small">
          <div>{res.runs} runs × {comd(res.unitAmount)} COMD = <span className="brass">{comd(res.amount)} COMD</span></div>
          {res.terms && <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{res.terms.map((t, i) => <li key={i} className="muted">{t}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
