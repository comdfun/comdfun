import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { ago, caption, fmtNum, iso, short, units } from "@/lib/format";
import { chainName } from "@/lib/chains";
import { verdictTone } from "@/lib/stage";
import { PageHead, Badge, Section, Addr, Seal } from "@/components/ui";
import { ClaimBox } from "@/components/ClaimBox";
import { LiveRefresh } from "@/components/LiveRefresh";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Incorporation" };

export default async function LaunchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [L, A] = await Promise.all([api.launch(id), api.assurances(id)]);
  if (!L) notFound();
  const rs = L.rewardSnapshot;
  return (
    <>
      <LiveRefresh active={!["live", "parked", "failed", "cancelled"].includes(L.status)} ms={8000} />
      <PageHead
        crumbs={[{ label: "The Docket", href: "/jobs" }, { label: "Matters", href: "/jobs" }, { label: `Incorporation #${L.launchNumber}` }]}
        title={L.token ? `$${L.token.symbol} · ${L.token.name}` : `Incorporation #${L.launchNumber}`}
        lede={L.objective ? <><span className="brass px" style={{ fontSize: 11 }}>In re:</span> {caption(L.objective, 220)}</> : undefined}
      />
      <div className="two-col">
        <div>
          <dl className="kv">
            <dt>Incorporation</dt><dd className="mono">{L.id}</dd>
            <dt>Status</dt><dd><Badge tone={verdictTone(L.status === "live" ? "accepted" : L.status === "parked" ? "failed" : "pending")} live={L.status === "building"}>{L.status}</Badge>{L.parkedReason && <span className="small err-text"> · {L.parkedReason}</span>}</dd>
            <dt>Kind</dt><dd className="mono">{L.kind}</dd>
            <dt>Chain</dt><dd>{chainName(L.chainId)}</dd>
            <dt>Source</dt><dd>{L.sourceRepoUrl ? <a className="ext break" href={L.sourceRepoUrl} target="_blank" rel="noreferrer">{L.sourceRepoUrl.replace("https://github.com/", "")}</a> : "—"}{L.sourceCommit && <span className="mono small muted"> @ {L.sourceCommit.slice(0, 10)}</span>}</dd>
            {L.jobId && (<><dt>Matter</dt><dd><Link href={`/jobs/${L.jobId}`}>{L.jobId}</Link></dd></>)}
            {L.policyVersion && (<><dt>Policy</dt><dd>v{L.policyVersion}</dd></>)}
            {L.pool && (<><dt>Pool</dt><dd className="mono small break">{short(L.pool.poolId, 10, 6)} · {L.pool.pairedWith} · fee {L.pool.fee / 10000}%{L.pool.hook ? <> · hook <Addr a={L.pool.hook} chainId={L.chainId} /></> : ""}</dd></>)}
          </dl>

          <Section num="§1" title="Lifecycle" id="lifecycle">
            <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 0 }}>
              {(L.lifecycle ?? []).map((s, i) => (
                <li key={i} style={{ display: "grid", gridTemplateColumns: "16px 140px minmax(0,1fr)", gap: 10, padding: "6px 0", borderLeft: "2px solid var(--rule)", marginLeft: 6, paddingLeft: 10 }}>
                  <span className="dot on" style={{ marginLeft: -16, marginTop: 6 }} aria-hidden="true" />
                  <span className="px" style={{ fontSize: 11 }}>{s.status}</span>
                  <span className="small muted">{ago(s.at)}{s.note ? ` · ${s.note}` : ""}</span>
                </li>
              ))}
            </ol>
          </Section>

          <Section num="§2" title="Admission checks" id="admission">
            <ul className="rows rv-kids">
              {(L.admission?.checks ?? []).map((c) => (
                <li key={c.id} style={{ padding: "8px 0", display: "grid", gridTemplateColumns: "minmax(140px, 200px) auto minmax(0,1fr)", gap: 10, alignItems: "center" }}>
                  <span className="mono small">{c.id}</span>
                  <Badge tone={verdictTone(c.status)}>{c.status}</Badge>
                  <span className="small muted">{c.detail}</span>
                </li>
              ))}
            </ul>
            {L.admission?.admittedAt && <p className="small muted">Admitted {iso(L.admission.admittedAt)}.</p>}
          </Section>

          <Section num="§3" title="Addresses and transactions" id="addresses">
            {L.artifacts.length === 0 && <p className="muted">Nothing deployed yet.</p>}
            <div className="table-wrap">
              <table className="table collapse">
                <thead><tr><th>Contract</th><th>Role</th><th>Address</th><th>Tx</th><th className="num">Block</th></tr></thead>
                <tbody>
                  {L.artifacts.map((a) => (
                    <tr key={a.address}>
                      <td data-k="Contract" className="span">{a.name}</td>
                      <td data-k="Role">{a.role}</td>
                      <td data-k="Address"><Addr a={a.address} chainId={L.chainId} /></td>
                      <td data-k="Tx"><Addr a={a.txHash} kind="tx" chainId={L.chainId} /></td>
                      <td data-k="Block" className="num">{fmtNum(a.blockNumber)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(L.transactions?.length ?? 0) > 0 && (
              <ul className="small" style={{ marginTop: 10 }}>
                {L.transactions!.map((t) => (<li key={t.txHash + t.label} className="rv">{t.label} · <Addr a={t.txHash} kind="tx" chainId={L.chainId} />{t.gasUsed ? ` · ${fmtNum(Number(t.gasUsed))} gas` : ""}</li>))}
              </ul>
            )}
          </Section>

          <Section num="§4" title="Allocations" id="allocations">
            <div style={{ display: "flex", height: 18, border: "2px solid var(--rule)", marginBottom: 10 }} aria-hidden="true">
              {(L.allocations ?? []).map((a, i) => (
                <span key={i} style={{ width: `${a.bps / 100}%`, background: ["var(--brass)", "var(--text)", "var(--verdigris)", "#2f6f5d"][i % 4] }} title={a.label} />
              ))}
            </div>
            <dl className="kv">
              {(L.allocations ?? []).map((a, i) => (<FragmentKV key={i} k={`${(a.bps / 100).toFixed(1)}%`} v={<>{a.label} → <span className="mono small">{/^0x/.test(a.to) ? short(a.to) : a.to}</span></>} />))}
            </dl>
            {L.token && <p className="small muted">Supply {units(L.token.totalSupply, 18, 0)} {L.token.symbol}. The swarm&apos;s 10% is split 2% equally among wallets that worked on the incorporation and 8% equally among seats connected in the recent window; per-wallet cap 30%; claims unlock after 1 hour.</p>}
          </Section>

          {rs && (
            <Section num="§5" title="Reward snapshot" id="rewards">
              <dl className="kv" style={{ marginBottom: 10 }}>
                <dt>Rule</dt><dd className="mono">{rs.rule} · v{rs.version}</dd>
                <dt>Taken</dt><dd>{iso(rs.at)}</dd>
                <dt>Worked</dt><dd>{rs.workers.length} wallets · {rs.workCount ?? rs.workers.reduce((a, w) => a + w.work.length, 0)} accepted steps{rs.workByKind ? ` (${Object.entries(rs.workByKind).map(([k, v]) => `${k} ${v}`).join(", ")})` : ""}</dd>
                <dt>Connected</dt><dd>{rs.connected.length} seats in the window</dd>
                {rs.root && (<><dt>Merkle root</dt><dd className="mono small break">{rs.root}</dd></>)}
              </dl>
              <div className="table-wrap">
                <table className="table collapse">
                  <thead><tr><th>Wallet</th><th className="num">Worked on it</th><th className="num">Connected</th></tr></thead>
                  <tbody>
                    {rs.breakdown.slice(0, 12).map((b) => (
                      <tr key={b.wallet}><td data-k="Wallet" className="span"><Addr a={b.wallet} chainId={L.chainId} /></td><td data-k="Worked" className="num">{units(b.launchAmount, 18, 0)}</td><td data-k="Connected" className="num">{units(b.recentAmount, 18, 0)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rs.breakdown.length > 12 && <p className="small muted">and {rs.breakdown.length - 12} more wallets.</p>}
            </Section>
          )}
        </div>
        <aside className="stack">
          {L.attestation && (
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>Attestation</h3><Seal label="Attested" /></div>
              <dl className="kv" style={{ marginTop: 10 }}>
                <dt>Build</dt><dd className="mono small break">{L.attestation.buildHash}</dd>
                <dt>Tree</dt><dd className="mono small">{L.attestation.treeHash.slice(0, 16)}…</dd>
                <dt>By</dt><dd><Addr a={L.attestation.attestedBy} /></dd>
                <dt>At</dt><dd>{ago(L.attestation.attestedAt)}</dd>
              </dl>
            </div>
          )}
          {L.status === "live" && <ClaimBox launchId={L.id} onchainLaunchId={L.onchainLaunchId ?? null} />}
          <div className="card">
            <h3>Assurances</h3>
            {(A?.assurances.length ?? 0) === 0 && <p className="small muted">No outside audits or bounties recorded.</p>}
            <ul className="small" style={{ paddingLeft: 16, margin: 0 }}>
              {A?.assurances.map((a, i) => (<li key={i}>{a.kind} · {a.url.startsWith("/") ? <Link href={a.url}>{a.provider}</Link> : <a className="ext" href={a.url} target="_blank" rel="noreferrer">{a.provider}</a>}{a.revokedAt ? <span className="bad"> · revoked</span> : ""}</li>))}
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}

function FragmentKV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
