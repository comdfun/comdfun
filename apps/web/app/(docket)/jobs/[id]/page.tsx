import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { jobStage, verdictTone } from "@/lib/stage";
import { ago, bytes, caption, counselName, docketNo, duration, fmtNum, compact, iso, short } from "@/lib/format";
import { artifactUrl, apiUrl } from "@/lib/links";
import { MOCK } from "@/lib/config";
import { chainName, explorerUrl } from "@/lib/chains";
import { PageHead, Avatar, Badge, Addr, Section, Stamp, Seal } from "@/components/ui";
import type { Job, JobNode, Submission } from "@/lib/types";
import { Pipeline } from "@/components/Pipeline";
import { RStamp } from "@/components/fx/Stamps";
import { LiveRefresh } from "@/components/LiveRefresh";

/** Where a matter sits on drafting → cross-examination → filing → deploying → on record. */
function pipelineAt(job: Job): { at: number; failed: boolean } {
  const reviewing = job.nodes.some((n) => n.role === "review" && (n.state === "running" || n.state === "ready"));
  const anyAccepted = job.nodes.some((n) => n.state === "accepted");
  switch (job.state) {
    case "completed": return { at: 5, failed: false };
    case "delivering": return { at: job.launch?.requested && job.launch.status !== "live" ? 3 : 2, failed: false };
    case "blocked": case "failed": return { at: reviewing || job.nodes.some((n) => n.state === "rejected") ? 1 : anyAccepted ? 2 : 0, failed: true };
    default: return { at: reviewing ? 1 : 0, failed: false };
  }
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Matter ${id.slice(0, 8)}` };
}

function levels(nodes: JobNode[]) {
  const lv = new Map<string, number>();
  const by = new Map(nodes.map((n) => [n.key, n]));
  const depth = (k: string, seen = new Set<string>()): number => {
    if (lv.has(k)) return lv.get(k)!;
    if (seen.has(k)) return 0;
    seen.add(k);
    const n = by.get(k);
    const d = n && n.dependsOn.length ? 1 + Math.max(...n.dependsOn.map((x) => depth(x, seen))) : 0;
    lv.set(k, d);
    return d;
  };
  nodes.forEach((n) => depth(n.key));
  const cols: JobNode[][] = [];
  nodes.forEach((n) => (cols[lv.get(n.key)!] ??= []).push(n));
  return cols.filter(Boolean);
}

const ROLE: Record<string, string> = { implement: "Drafting", tests: "Tests", review: "Cross-examination", integrate: "Integration" };
const EXHIBIT = (i: number) => `Exhibit ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ""}`;

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [job, records] = await Promise.all([api.job(id), api.records(id)]);
  if (!job) notFound();
  const subs = await api.submissions(id, job);
  const pos = pipelineAt(job);
  const stage = jobStage(job);
  const seats = [...new Set(job.nodes.map((n) => n.seat?.tokenId).filter(Boolean) as string[])];
  const cols = levels(job.nodes);
  const submissions: Submission[] = subs?.submissions ?? [];
  const totalMs = submissions.reduce((a, s) => a + (s.usage?.wallClockMs ?? 0), 0);
  const totalTurns = submissions.reduce((a, s) => a + (s.usage?.turns ?? 0), 0);
  const files = job.media?.files ?? [];
  const reviewSubs = submissions.filter((s) => s.role === "review");

  return (
    <>
      <LiveRefresh active={!["completed", "blocked", "cancelled", "failed", "superseded"].includes(job.state)} />
      <PageHead
        crumbs={[{ label: "The Docket", href: "/jobs" }, { label: "Matters", href: "/jobs" }, { label: docketNo("Matter", job.id, job.createdAt) }]}
        kicker={<><span className="docket">{docketNo("Matter", job.id, job.createdAt)}</span><Badge tone={stage.tone} title={stage.title} live={stage.live} fill>{stage.label}</Badge>{job.state === "completed" && <RStamp>On the record</RStamp>}</>}
        title={<span className="pix" style={{ fontSize: "clamp(20px, 3vw, 30px)", display: "block", textTransform: "none", lineHeight: 1.3 }}><span className="caption-in-re"><span className="inre" style={{ fontSize: 14 }}>In re:</span></span>{caption(job.objective, 140)}</span>}
      />
      <div style={{ marginBottom: 28 }}><Pipeline current={pos.at} failed={pos.failed} /></div>
      <div className="two-col">
        <div>
          <dl className="kv">
            <dt>Matter</dt>
            <dd className="mono">{job.id}</dd>
            <dt>Status</dt>
            <dd className="row" style={{ gap: 8 }}>
              <Badge tone={stage.tone} title={stage.title} live={stage.live}>{stage.label}</Badge>
              <span className="muted small">{job.state}{job.blockedReason ? ` · ${job.blockedReason}` : ""}</span>
            </dd>
            <dt>Paid by</dt>
            <dd><Addr a={job.paidBy} /></dd>
            <dt>Counsel</dt>
            <dd className="row" style={{ gap: 6 }}>
              {seats.length ? seats.map((s) => (
                <span key={s} className="row" style={{ gap: 6 }}>
                  <Avatar tokenId={s} />
                  <Link className="nameplate" href={`/agents/${s}`}>{counselName(s)}</Link>
                </span>
              )) : <span className="muted">none assigned yet</span>}
            </dd>
            <dt>Opened</dt>
            <dd>{iso(job.createdAt)} <span className="muted">({ago(job.createdAt)})</span></dd>
            <dt>Updated</dt>
            <dd>{ago(job.updatedAt)}</dd>
            <dt>Template</dt>
            <dd className="mono">{job.template ?? "—"}</dd>
            {job.parentJobId && (<><dt>Continues</dt><dd><Link href={`/jobs/${job.parentJobId}`}>{job.parentJobId}</Link></dd></>)}
            {job.workflow && (<><dt>Workflow</dt><dd>{job.workflow.id} · {job.workflow.status}</dd></>)}
            {job.oracleRequestId && (<><dt>Ruling</dt><dd><Link href={`/oracle/${job.oracleRequestId}`}>{job.oracleRequestId}</Link></dd></>)}
          </dl>

          <Section num="§1" title="The objective" id="objective">
            <div className="panel" style={{ whiteSpace: "pre-wrap" }}>{job.objective}</div>
          </Section>

          <Section num="§2" title={`The plan · ${job.nodes.length} step${job.nodes.length === 1 ? "" : "s"}`} id="plan">
            <div style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(200px, 1fr)", gap: 12, overflowX: "auto", paddingBottom: 6 }}>
              {cols.map((col, ci) => (
                <div key={ci} style={{ display: "grid", gap: 10, alignContent: "start" }}>
                  <div className="label">Stage {ci + 1}</div>
                  {col.map((n) => (
                    <div key={n.key} className="card" style={{ padding: 12 }}>
                      <div className="row" style={{ justifyContent: "space-between", gap: 6 }}>
                        <span className="px" style={{ fontSize: 11 }}>{ROLE[n.role] ?? n.role}</span>
                        <Badge tone={verdictTone(n.state)} live={n.state === "running"}>{n.state}</Badge>
                      </div>
                      <div className="mono small" style={{ margin: "6px 0" }}>{n.key}</div>
                      {n.dependsOn.length > 0 && <div className="small muted">after {n.dependsOn.join(", ")}</div>}
                      <div className="row small" style={{ gap: 6, marginTop: 6 }}>
                        {n.seat ? (<><Avatar tokenId={n.seat.tokenId} /><Link href={`/agents/${n.seat.tokenId}`}>#{n.seat.tokenId}</Link></>) : <span className="muted">unassigned</span>}
                        <span className="muted">attempt {n.attempt}</span>
                      </div>
                      {n.verdict?.detail && <div className="small muted" style={{ marginTop: 6 }}>{n.verdict.detail}</div>}
                      {n.failureReason && <div className="small err-text" style={{ marginTop: 6 }}>{n.failureReason}</div>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Section>

          {files.length > 0 && (
            <Section num="§3" title={`Exhibits · ${files.length}`} id="exhibits">
              <div className="grid g3">
                {files.map((f, i) => (
                  <a key={f.hash} className="card" href={artifactUrl(f.hash)} target="_blank" rel="noreferrer" style={{ textDecoration: "none", display: "grid", gap: 8 }}>
                    <Stamp c={["gold", "pink", "cyan", "lime", "orange", "violet"][i % 6]}>{EXHIBIT(i)}</Stamp>
                    {f.mediaType.startsWith("image/") && !MOCK ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={artifactUrl(f.hash)} alt={f.path} style={{ width: "100%", aspectRatio: "1", objectFit: "contain", background: "#000" }} loading="lazy" />
                    ) : null}
                    <span className="mono small break">{f.path.replace(/^artifacts\//, "")}</span>
                    <span className="small muted">{f.mediaType} · {bytes(f.bytes)}</span>
                  </a>
                ))}
              </div>
            </Section>
          )}

          <Section num="§4" title={`The work · ${submissions.length} submission${submissions.length === 1 ? "" : "s"}`} id="work">
            {submissions.length === 0 && <p className="muted">Nothing submitted yet.</p>}
            <div className="stack">
              {submissions.map((s) => (
                <article key={s.hash} className="card rv" aria-label={`Submission ${s.nodeKey}`}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div className="row" style={{ gap: 8 }}>
                      {s.seat && <Avatar tokenId={s.seat.tokenId} size={32} />}
                      <div>
                        <div className="px" style={{ fontSize: 12 }}>{ROLE[s.role] ?? s.role} · <span className="mono" style={{ textTransform: "none" }}>{s.nodeKey}</span></div>
                        <div className="small muted">posted {ago(s.createdAt)} by {s.seat ? <Link href={`/agents/${s.seat.tokenId}`}>{counselName(s.seat.tokenId)}</Link> : "—"} · attempt {s.attempt}</div>
                      </div>
                    </div>
                    {s.accepted ? <RStamp /> : s.accepted === false ? <RStamp kind="overruled" /> : <Badge tone="brass" live>{s.outcome}</Badge>}
                  </div>
                  {s.usage && (
                    <dl className="kv" style={{ marginTop: 12 }}>
                      <dt>Runtime</dt><dd>{s.usage.runtime} · <span className="mono">{s.usage.model}</span></dd>
                      <dt>Duration</dt><dd>{duration(s.usage.wallClockMs)}</dd>
                      <dt>Turns</dt><dd>{s.usage.turns}</dd>
                      <dt>Tokens</dt><dd>{compact(s.usage.inputTokens)} in · {compact(s.usage.outputTokens)} out · {compact(s.usage.cachedInputTokens)} cached</dd>
                      <dt>Files changed</dt><dd>{s.changedPaths.length}{s.changedPaths.length > 0 && <span className="muted small"> · {s.changedPaths.slice(0, 6).join(", ")}{s.changedPaths.length > 6 ? "…" : ""}</span>}</dd>
                      {s.verdict && (<><dt>Verdict</dt><dd><Badge tone={verdictTone(s.verdict.status)}>{s.verdict.status}</Badge> <span className="small muted">{s.verdict.evaluation} · {s.verdict.detail}</span></dd></>)}
                      {s.failureReason && (<><dt>Failure</dt><dd className="err-text">{s.failureReason}</dd></>)}
                    </dl>
                  )}
                  {s.summary && (
                    <details className="fold" style={{ marginTop: 12 }} open={submissions.length === 1}>
                      <summary>Counsel&apos;s statement</summary>
                      <div className="inner" style={{ whiteSpace: "pre-wrap" }}>{s.summary}</div>
                    </details>
                  )}
                  {s.findings.length > 0 && (
                    <ul className="small" style={{ margin: "10px 0 0", paddingLeft: 18 }}>
                      {s.findings.map((f, k) => (<li key={k}><span className={f.severity === "high" || f.severity === "critical" ? "bad" : "brass"}>{f.severity}</span> · {f.title}{f.detail ? ` — ${f.detail}` : ""}</li>))}
                    </ul>
                  )}
                </article>
              ))}
            </div>
            {submissions.length > 0 && <p className="small muted" style={{ marginTop: 10 }}>Total: {duration(totalMs)} · {fmtNum(totalTurns)} turns across {submissions.length} submissions.</p>}
          </Section>

          {reviewSubs.length > 0 && (
            <Section num="§5" title="Cross-examination" id="reviews">
              <ul className="rows rv-kids">
                {reviewSubs.map((r) => (
                  <li key={r.hash} style={{ padding: "10px 0" }} className="row">
                    <Badge tone={r.accepted ? "ok" : "bad"}>{r.accepted ? "No unresolved findings" : "Findings stand"}</Badge>
                    <span className="mono small">{r.nodeKey}</span>
                    <span className="small muted">by {r.seat ? counselName(r.seat.tokenId) : "—"} · {r.findings.length} finding{r.findings.length === 1 ? "" : "s"}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {(job.knownLimitations?.length ?? 0) > 0 && (
            <Section num="§6" title="Known limitations" id="limitations">
              <ul className="prose">{job.knownLimitations!.map((l, i) => <li key={i} className="rv">{l}</li>)}</ul>
            </Section>
          )}
        </div>

        <aside className="stack">
          <div className="folder c-cyan" data-tab="Delivery">
            <dl className="kv">
              <dt>Repository</dt><dd>{job.delivery?.repoUrl ? <a className="ext break" href={job.delivery.repoUrl} target="_blank" rel="noreferrer">{job.delivery.repoUrl.replace("https://github.com/", "")}</a> : <span className="muted">—</span>}</dd>
              <dt>Pull request</dt><dd>{job.delivery?.pullRequestUrl ? <a className="ext" href={job.delivery.pullRequestUrl} target="_blank" rel="noreferrer">open</a> : <span className="muted">—</span>}</dd>
              <dt>Commit</dt><dd className="mono">{job.delivery?.commit ? short(job.delivery.commit, 10, 0).replace("…", "") : "—"}</dd>
              <dt>Site</dt><dd>{job.site ? <a className="ext break" href={job.site.url} target="_blank" rel="noreferrer">{job.site.url.replace(/^https?:\/\//, "")}</a> : <span className="muted">—</span>}</dd>
              <dt>Media</dt><dd>{files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : <span className="muted">—</span>}</dd>
              <dt>Incorporation</dt>
              <dd>{job.launch?.requested ? (job.launch.id ? <Link href={`/launches/${job.launch.id}`}>{job.launch.kind} · {job.launch.status}</Link> : `${job.launch.kind} · ${job.launch.status}`) : <span className="muted">—</span>}</dd>
            </dl>
          </div>
          <div className="folder c-lime" data-tab="On the record" style={{ marginTop: 30 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>ERC-8004 receipts</h3>
              {job.reviews.some((r) => r.status === "sent") && <Seal label="Recorded" />}
            </div>
            {job.reviews.length === 0 && (records?.records.length ?? 0) === 0 && <p className="small muted" style={{ marginTop: 8 }}>Nothing recorded yet. Accepted work is written to the ERC-8004 Reputation Registry in batches.</p>}
            {job.reviews.map((r, i) => (
              <dl className="kv" key={i} style={{ marginTop: 10 }}>
                <dt>Receipt</dt><dd><Badge tone={verdictTone(r.status)}>{r.status === "sent" ? "Work accepted" : r.status}</Badge></dd>
                <dt>Scores</dt><dd>{r.entries.length} score{r.entries.length === 1 ? "" : "s"} · {[...new Set(r.entries.map((e) => e.role.replace("verification:", "")))].join(", ")} · all {r.entries.filter((e) => e.value > 0).length} passed</dd>
                <dt>Chain</dt><dd>{chainName(r.chainId)}</dd>
                <dt>Block</dt><dd>{r.blockNumber ? <a className="ext" href={explorerUrl("block", r.blockNumber, r.chainId)} target="_blank" rel="noreferrer">{fmtNum(r.blockNumber)}</a> : "—"}</dd>
                <dt>Tx</dt><dd><Addr a={r.txHash} kind="tx" chainId={r.chainId} /></dd>
              </dl>
            ))}
            {(records?.records ?? []).length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div className="label">Work records</div>
                <ul className="rows small">
                  {records!.records.map((r) => (
                    <li key={r.id} style={{ padding: "6px 0", display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <a href={apiUrl(`/work-records/${r.hash}.json`)} className="mono ext" target="_blank" rel="noreferrer">{short(r.hash, 8, 4)}</a>
                      <Badge tone={verdictTone(r.status)}>{r.status}</Badge>
                      <Addr a={r.txHash} kind="tx" chainId={r.chainId} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {job.project && job.project.versions.length > 1 && (
            <div className="card">
              <h3>Project versions</h3>
              <ol className="small" style={{ paddingLeft: 18, margin: 0 }}>
                {job.project.versions.map((v) => (<li key={v.jobId}><Link href={`/jobs/${v.jobId}`}>{caption(v.objective, 60)}</Link> <span className="muted">· {v.state}</span></li>))}
              </ol>
            </div>
          )}
          <p className="small muted">On the API: <a className="ext" href={apiUrl(`/jobs/${job.id}`)} target="_blank" rel="noreferrer">/jobs/{job.id.slice(0, 8)}…</a> · <a className="ext" href={apiUrl(`/jobs/${job.id}/submissions`)} target="_blank" rel="noreferrer">submissions</a></p>
        </aside>
      </div>
    </>
  );
}
