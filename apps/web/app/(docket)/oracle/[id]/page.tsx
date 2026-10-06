import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { oracleStage } from "@/lib/stage";
import { ago, counselName, docketNo, fmtNum, iso, short } from "@/lib/format";
import { chainName, explorerUrl } from "@/lib/chains";
import { apiUrl } from "@/lib/links";
import { PageHead, Badge, Seal, Section, Avatar, Addr } from "@/components/ui";
import { LiveRefresh } from "@/components/LiveRefresh";
import { CodeBlock, CopyButton } from "@/components/CopyButton";
import { RStamp } from "@/components/fx/Stamps";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: `Ruling ${(await params).id.slice(0, 8)}` };
}

export default async function OracleDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [o, att] = await Promise.all([api.oracle(id), api.attestation(id)]);
  if (!o) notFound();
  const st = oracleStage(o.status);
  const w = o.window;
  return (
    <>
      <LiveRefresh active={["assessing", "reproducing", "queued", "pending"].includes(o.status)} />
      <PageHead crumbs={[{ label: "The Docket", href: "/jobs" }, { label: "Rulings", href: "/oracle" }, { label: docketNo("Ruling", o.id, o.createdAt) }]} kicker={<><span className="docket">{docketNo("Ruling", o.id, o.createdAt)}</span><Badge tone={st.tone} live={st.live} fill>{st.label}</Badge><span className="badge cyan">{chainName(o.chainId)}</span></>}
        title={<span className="pix" style={{ fontSize: "clamp(20px, 3vw, 30px)", display: "block", textTransform: "none", lineHeight: 1.3, textShadow: "none" }}>{o.question}</span>} />
      <div className="two-col">
        <div>
          <div className="folder c-violet" data-tab="The ruling" style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
            {o.status === "attested" ? <Seal big label="Sealed" /> : <Badge tone={st.tone} live={st.live} title={st.title}>{st.label}</Badge>}
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="label">The answer</div>
              <div className="num" style={{ fontSize: 52, lineHeight: 1, color: "var(--violet)", textShadow: "4px 4px 0 var(--violet-sh)", wordBreak: "break-word" }}>{o.agreement?.answer ?? o.computed?.answer ?? "—"}</div>
              {o.agreement && <div className="small muted">{o.agreement.agreed} of {o.panelSize} counsel agreed · quorum {o.quorum}{o.toleranceBps != null ? ` · tolerance ${o.toleranceBps} bps` : ""}</div>}
              {o.failure && <div className="small err-text">{o.failure}</div>}
            </div>
            {o.status === "attested" ? <RStamp kind="sealed" lg>Sealed</RStamp> : ["disagreed", "mismatch", "refused", "failed"].includes(o.status) ? <RStamp kind="overruled" lg>{st.label}</RStamp> : null}
          </div>

          <Section num="§1" title="The question" id="question">
            <dl className="kv">
              <dt>Request</dt><dd className="mono">{o.id}</dd>
              <dt>Chain</dt><dd>{chainName(o.chainId)} ({o.chainId})</dd>
              <dt>Window</dt><dd>{w.fromBlock != null ? <>blocks {fmtNum(w.fromBlock)} → {fmtNum(w.toBlock)}</> : w.hours ? `${w.hours} hours` : "—"}</dd>
              {w.toBlockHash && (<><dt>Closing block</dt><dd className="mono small break">{w.toBlockHash}</dd></>)}
              <dt>Answer type</dt><dd className="mono">{o.answerType}</dd>
              <dt>Evidence</dt><dd>{o.evidence === "panel" ? "panel (sources outside the chain)" : "chain (reproduced by the Registrar)"}</dd>
              <dt>Panel</dt><dd>{o.panelSize} counsel · quorum {o.quorum} (all must match)</dd>
              <dt>Valid for</dt><dd>{Math.round(o.validForSeconds / 3600)} h after signing</dd>
              <dt>Asked</dt><dd>{iso(o.createdAt)} ({ago(o.createdAt)})</dd>
              {o.jobId && (<><dt>Panel matter</dt><dd><Link href={`/jobs/${o.jobId}`}>{o.jobId}</Link></dd></>)}
              {o.consumer && (<><dt>Consumer</dt><dd>{chainName(o.consumer.chainId)} · <span className="mono">{short(o.consumer.verifyingContract)}</span></dd></>)}
            </dl>
            {o.definitions && Object.keys(o.definitions).length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="label" style={{ marginBottom: 6 }}>Definitions</div>
                <dl className="kv">{Object.entries(o.definitions).map(([k, v]) => (<Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>))}</dl>
              </div>
            )}
          </Section>

          <Section num="§2" title={`The panel · ${o.members.length}`} id="panel">
            <ul className="rows">
              {o.members.map((m, i) => (
                <li key={i} style={{ padding: "10px 0", display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", gap: 12, alignItems: "start" }}>
                  {m.tokenId ? <Avatar tokenId={m.tokenId} size={32} /> : <span className="av" />}
                  <div>
                    <div className="small">{m.tokenId ? <Link href={`/agents/${m.tokenId}`}>{counselName(m.tokenId)}</Link> : `Member ${i + 1}`}</div>
                    <div className="mono" style={{ wordBreak: "break-word" }}>{m.answer?.answer ?? m.failure ?? "—"}</div>
                    {m.answer?.notes && <div className="small muted">{m.answer.notes}</div>}
                  </div>
                  {m.ok ? <RStamp i={i % 6}>Concurs</RStamp> : <RStamp kind="overruled" i={i % 6}>Dissents</RStamp>}
                </li>
              ))}
            </ul>
          </Section>

          <Section num="§3" title="Agreement and computation" id="agreement">
            <dl className="kv">
              <dt>Agreed</dt><dd>{o.agreement ? `${o.agreement.agreed} / ${o.panelSize} (quorum ${o.agreement.quorum})` : "—"}</dd>
              <dt>Answer</dt><dd className="mono break">{o.agreement?.answer ?? "—"}</dd>
              <dt>Figure</dt><dd className="mono">{o.agreement?.figure ?? "—"}</dd>
              <dt>Computed</dt><dd className="mono break">{o.computed ? `${o.computed.answer}${o.computed.figure ? ` (figure ${o.computed.figure})` : ""}` : "—"}</dd>
              <dt>Sources</dt><dd>{o.agreement?.sources?.join(", ") || "—"}</dd>
            </dl>
          </Section>

          {att && (
            <Section num="§4" title="Attestation (EIP-712)" id="attestation">
              <dl className="kv" style={{ marginBottom: 12 }}>
                <dt>Signer</dt><dd><Addr a={att.signer} full /></dd>
                <dt>Signature</dt><dd className="mono small break">{att.signature} <CopyButton text={att.signature} /></dd>
                <dt>Signed</dt><dd>{iso(att.attestedAt)}</dd>
              </dl>
              <CodeBlock lang="json" code={JSON.stringify({ domain: att.domain, primaryType: att.primaryType, message: att.message }, null, 2)} />
            </Section>
          )}
        </div>
        <aside className="stack">
          <div className="card">
            <h3>On the record</h3>
            <dl className="kv">
              <dt>Status</dt><dd><Badge tone={st.tone}>{o.status}</Badge></dd>
              <dt>Attested</dt><dd>{o.attestedAt ? ago(o.attestedAt) : "—"}</dd>
              <dt>Issued</dt><dd>{o.attestation ? iso(o.attestation.issuedAt * 1000) : "—"}</dd>
              <dt>Expires</dt><dd>{o.attestation?.expiresAt ? iso(o.attestation.expiresAt * 1000) : "—"}</dd>
              <dt>Block</dt><dd>{w.toBlock ? <a className="ext" href={explorerUrl("block", w.toBlock, o.chainId)} target="_blank" rel="noreferrer">{fmtNum(w.toBlock)}</a> : "—"}</dd>
            </dl>
          </div>
          <div className="card small">
            <h3>Use it on-chain</h3>
            <p className="muted">Verify the signature with <span className="mono">OracleAttestationVerifier</span> against domain “Company.md Oracle”, version 1, your consumer&apos;s chain and contract.</p>
            <a className="ext" href={apiUrl(`/oracle/requests/${o.id}/attestation`)} target="_blank" rel="noreferrer">GET /oracle/requests/:id/attestation</a>
          </div>
        </aside>
      </div>
    </>
  );
}
