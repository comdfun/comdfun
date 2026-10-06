"use client";
import { useId } from "react";

export const ANSWER_TYPES = ["bool", "address", "bytes32", "uint256", "address[]", "bytes32[]"] as const;
export const ORACLE_CHAINS = [
  { id: 4663, name: "Robinhood Chain" },
  { id: 46630, name: "Robinhood Chain Testnet" },
  { id: 1, name: "Ethereum mainnet" },
  { id: 8453, name: "Base" },
];

export interface OracleState {
  question: string;
  chainId: number;
  windowMode: "hours" | "blocks";
  hours: number;
  fromBlock: string;
  toBlock: string;
  answerType: (typeof ANSWER_TYPES)[number];
  head: string;
  panelSize: number;
  quorum: number;
  validFor: number; // seconds
  evidence: "chain" | "panel";
  toleranceBps: string;
  definitions: { k: string; v: string }[];
  consumerChainId: number;
  consumer: string;
}

export const defaultOracle = (chainId: number): OracleState => ({
  question: "",
  chainId,
  windowMode: "hours",
  hours: 24,
  fromBlock: "",
  toBlock: "",
  answerType: "bool",
  head: "",
  panelSize: 5,
  quorum: 5,
  validFor: 86400,
  evidence: "chain",
  toleranceBps: "",
  definitions: [],
  consumerChainId: chainId,
  consumer: "",
});

/** oracle.request v1 body from the form. */
export function oracleBody(s: OracleState) {
  const defs = Object.fromEntries(s.definitions.filter((d) => d.k.trim() && d.v.trim()).map((d) => [d.k.trim().slice(0, 64), d.v.trim().slice(0, 512)]));
  return {
    v: 1,
    question: s.question.trim(),
    chainId: s.chainId,
    window: s.windowMode === "hours" ? { hours: s.hours } : { fromBlock: Number(s.fromBlock), toBlock: Number(s.toBlock) },
    answerType: s.answerType,
    ...(s.answerType.endsWith("[]") && s.head ? { head: Number(s.head) } : {}),
    panelSize: s.panelSize,
    quorum: Math.min(s.quorum, s.panelSize),
    validForSeconds: s.validFor,
    evidence: s.evidence,
    ...(s.answerType === "uint256" && s.toleranceBps !== "" ? { toleranceBps: Number(s.toleranceBps) } : {}),
    ...(Object.keys(defs).length ? { definitions: defs } : {}),
    consumer: { chainId: s.consumerChainId, verifyingContract: (s.consumer || "0x0000000000000000000000000000000000000000").toLowerCase() },
  };
}

const VALID = [
  [3600, "1 hour"],
  [21600, "6 hours"],
  [86400, "1 day"],
  [604800, "7 days"],
  [2592000, "30 days"],
] as const;

export function OracleFields({ s, set, minPanel = 5, maxPanel = 100, compact }: { s: OracleState; set: (p: Partial<OracleState>) => void; minPanel?: number; maxPanel?: number; compact?: boolean }) {
  const id = useId();
  return (
    <div className="stack">
      <div className="field">
        <label htmlFor={`${id}-q`}>The question</label>
        <textarea
          id={`${id}-q`}
          value={s.question}
          maxLength={2000}
          rows={compact ? 3 : 4}
          onChange={(e) => set({ question: e.target.value })}
          placeholder="How much $COMD was burned on Robinhood Chain in the window? Count Transfer events to the zero address from the token contract."
        />
        <span className="hint">One question, one answer. Name what is measured and where; the panel answers exactly what you write.</span>
      </div>
      <div className="grid g2">
        <div className="field">
          <label htmlFor={`${id}-chain`}>Chain read</label>
          <select id={`${id}-chain`} value={s.chainId} onChange={(e) => set({ chainId: Number(e.target.value) })}>
            {ORACLE_CHAINS.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="label" id={`${id}-wl`}>Window</span>
          <div className="row" style={{ gap: 8 }}>
            <div className="seg" role="group" aria-labelledby={`${id}-wl`}>
              <button type="button" aria-pressed={s.windowMode === "hours"} onClick={() => set({ windowMode: "hours" })}>Hours</button>
              <button type="button" aria-pressed={s.windowMode === "blocks"} onClick={() => set({ windowMode: "blocks" })}>Blocks</button>
            </div>
            {s.windowMode === "hours" ? (
              <input aria-label="Window in hours, 1 to 720" type="number" min={1} max={720} value={s.hours} onChange={(e) => set({ hours: Math.max(1, Math.min(720, Number(e.target.value) || 1)) })} style={{ width: 90 }} />
            ) : (
              <>
                <input aria-label="From block" type="number" min={0} placeholder="from" value={s.fromBlock} onChange={(e) => set({ fromBlock: e.target.value })} style={{ width: 110 }} />
                <input aria-label="To block" type="number" min={0} placeholder="to" value={s.toBlock} onChange={(e) => set({ toBlock: e.target.value })} style={{ width: 110 }} />
              </>
            )}
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${id}-at`}>Answer type</label>
          <select id={`${id}-at`} value={s.answerType} onChange={(e) => set({ answerType: e.target.value as OracleState["answerType"] })}>
            {ANSWER_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        {s.answerType.endsWith("[]") ? (
          <div className="field">
            <label htmlFor={`${id}-head`}>Head (leading entries, 1–32)</label>
            <input id={`${id}-head`} type="number" min={1} max={32} value={s.head} onChange={(e) => set({ head: e.target.value })} placeholder="3" />
          </div>
        ) : s.answerType === "uint256" ? (
          <div className="field">
            <label htmlFor={`${id}-tol`}>Tolerance (bps, 0–10,000)</label>
            <input id={`${id}-tol`} type="number" min={0} max={10000} value={s.toleranceBps} onChange={(e) => set({ toleranceBps: e.target.value })} placeholder="0" />
          </div>
        ) : (
          <div />
        )}
        <div className="field">
          <label htmlFor={`${id}-ps`}>Panel size ({minPanel}–{maxPanel})</label>
          <input id={`${id}-ps`} type="number" min={minPanel} max={maxPanel} value={s.panelSize} onChange={(e) => { const n = Math.max(1, Math.min(maxPanel, Number(e.target.value) || minPanel)); set({ panelSize: n, quorum: Math.min(s.quorum, n) }); }} />
          <span className="hint">One member per seat.</span>
        </div>
        <div className="field">
          <label htmlFor={`${id}-qu`}>Quorum (2–{s.panelSize})</label>
          <input id={`${id}-qu`} type="number" min={2} max={s.panelSize} value={s.quorum} onChange={(e) => set({ quorum: Math.max(2, Math.min(s.panelSize, Number(e.target.value) || 2)) })} />
          <span className="hint">Matching answers needed. Not a majority: all {s.quorum} must match.</span>
        </div>
        <div className="field">
          <label htmlFor={`${id}-vf`}>Valid for</label>
          <select id={`${id}-vf`} value={s.validFor} onChange={(e) => set({ validFor: Number(e.target.value) })}>
            {VALID.map(([v, l]) => (
              <option key={v} value={v}>{l} after signing</option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="label" id={`${id}-ev`}>Evidence</span>
          <div className="seg" role="group" aria-labelledby={`${id}-ev`}>
            <button type="button" aria-pressed={s.evidence === "chain"} onClick={() => set({ evidence: "chain" })}>Chain</button>
            <button type="button" aria-pressed={s.evidence === "panel"} onClick={() => set({ evidence: "panel" })}>Panel</button>
          </div>
          <span className="hint">{s.evidence === "chain" ? "Read from the chain and reproduced by the Registrar." : "Sources outside the chain; pin them in definitions."}</span>
        </div>
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 6 }}>Definitions (pin the metric, the time range, the sources)</legend>
        <div className="stack" style={{ gap: 8 }}>
          {s.definitions.map((d, i) => (
            <div className="row" key={i} style={{ gap: 8, alignItems: "stretch" }}>
              <input aria-label={`Definition ${i + 1} key`} value={d.k} maxLength={64} placeholder="burn" onChange={(e) => set({ definitions: s.definitions.map((x, k) => (k === i ? { ...x, k: e.target.value } : x)) })} style={{ width: 140 }} />
              <input aria-label={`Definition ${i + 1} meaning`} className="grow" value={d.v} maxLength={512} placeholder="Transfer events to 0x000…000 from the token contract." onChange={(e) => set({ definitions: s.definitions.map((x, k) => (k === i ? { ...x, v: e.target.value } : x)) })} />
              <button type="button" className="btn sm ghost" onClick={() => set({ definitions: s.definitions.filter((_, k) => k !== i) })} aria-label={`Remove definition ${i + 1}`}>Strike</button>
            </div>
          ))}
          <div>
            <button type="button" className="btn sm" onClick={() => set({ definitions: [...s.definitions, { k: "", v: "" }] })} disabled={s.definitions.length >= 16}>Add definition</button>
          </div>
        </div>
      </fieldset>
      {!compact && (
        <div className="grid g2">
          <div className="field">
            <label htmlFor={`${id}-cc`}>Consumer chain</label>
            <select id={`${id}-cc`} value={s.consumerChainId} onChange={(e) => set({ consumerChainId: Number(e.target.value) })}>
              {ORACLE_CHAINS.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-cv`}>Consumer contract (EIP-712 verifyingContract)</label>
            <input id={`${id}-cv`} value={s.consumer} onChange={(e) => set({ consumer: e.target.value.trim() })} placeholder="0x… (the contract that verifies the signature)" spellCheck={false} />
          </div>
        </div>
      )}
    </div>
  );
}
