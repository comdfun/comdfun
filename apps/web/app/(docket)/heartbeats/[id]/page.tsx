import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { scheduleStage, cadenceText, verdictTone } from "@/lib/stage";
import { ago, docketNo, fmtNum, iso } from "@/lib/format";
import { PageHead, Badge, Addr, Section } from "@/components/ui";
import { CodeBlock } from "@/components/CopyButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Retainer" };

export default async function Heartbeat({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await api.schedule(id);
  if (!s) notFound();
  const st = scheduleStage(s.status);
  const used = s.runs.total - s.runs.remaining;
  const resultHref = (r: { kind: string; id: string }) => (r.kind === "oracle" ? `/oracle/${r.id}` : `/jobs/${r.id}`);
  return (
    <>
      <PageHead crumbs={[{ label: "The Docket", href: "/jobs" }, { label: "Retainers", href: "/heartbeats" }, { label: docketNo("Retainer", s.id, s.createdAt) }]} title={s.label ?? "Retainer"} />
      <div className="two-col">
        <div>
          <dl className="kv">
            <dt>Retainer</dt><dd className="mono">{s.id}</dd>
            <dt>Status</dt><dd><Badge tone={st.tone} live={st.live} title={st.title}>{st.label}</Badge>{s.pausedReason && <span className="small muted"> · {s.pausedReason}</span>}</dd>
            <dt>Action</dt><dd className="mono">{s.action}{s.continue ? " · continue" : ""}</dd>
            <dt>Cadence</dt><dd>{cadenceText(s.cadence)}</dd>
            <dt>Runs</dt><dd>{fmtNum(s.runs.remaining)} left · {fmtNum(used)} used · {fmtNum(s.runsBought)} bought</dd>
            <dt>Next run</dt><dd>{s.nextRunAt ? `${iso(s.nextRunAt)} (${ago(s.nextRunAt)})` : "—"}</dd>
            <dt>Last run</dt><dd>{s.lastRunAt ? ago(s.lastRunAt) : "—"}</dd>
            <dt>Owner</dt><dd><Addr a={s.owner} /></dd>
            <dt>Created</dt><dd>{iso(s.createdAt)}</dd>
          </dl>
          <div className="meter" style={{ marginTop: 14 }} aria-label={`${used} of ${s.runs.total} runs used`}><span style={{ width: `${(used / Math.max(1, s.runs.total)) * 100}%` }} /></div>

          <Section num="§1" title="Latest runs" id="runs">
            {(s.latest?.length ?? 0) === 0 && <p className="muted">No runs yet.</p>}
            <div className="table-wrap">
              <table className="table collapse">
                <thead><tr><th>Run</th><th>Status</th><th>Due</th><th>Fired</th><th>Missed</th><th>Result</th></tr></thead>
                <tbody>
                  {s.latest?.map((r) => (
                    <tr key={r.seq}>
                      <td data-k="Run" className="mono">#{r.seq}</td>
                      <td data-k="Status"><Badge tone={verdictTone(r.status === "opened" ? "accepted" : r.status === "failed" ? "failed" : "pending")}>{r.status}</Badge></td>
                      <td data-k="Due">{ago(r.dueAt)}</td>
                      <td data-k="Fired">{r.firedAt ? ago(r.firedAt) : "—"}</td>
                      <td data-k="Missed">{r.missedSlots}</td>
                      <td data-k="Result" className="span">{r.result ? <Link href={resultHref(r.result)}>{r.result.kind} {r.result.id.slice(0, 8)}</Link> : r.failure ? <span className="err-text small">{r.failure}</span> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section num="§2" title="Frozen input" id="input">
            <CodeBlock lang="json" code={JSON.stringify(s.input, null, 2)} />
          </Section>
        </div>
        <aside className="stack">
          <div className="card">
            <h3>Top up</h3>
            <p className="small muted">Any wallet can add runs at today&apos;s price per run. An exhausted or paused retainer resumes from the next slot. No refunds.</p>
            <Link className="btn primary" href={`/launch?mode=topup&schedule=${s.id}`}>Add runs</Link>
          </div>
        </aside>
      </div>
    </>
  );
}
