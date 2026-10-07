import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { ago, caption, counselName, duration, fmtNum, short } from "@/lib/format";
import { avatarUrl } from "@/lib/links";
import { chainName, explorerUrl, activeChain } from "@/lib/chains";
import { addressOf } from "@/lib/contracts";
import { MARKETPLACE_URL } from "@/lib/config";
import { runtimeLabel } from "@/lib/normalize";
import { PageHead, Badge, Section, Avatar, Runtime } from "@/components/ui";
import { RStamp } from "@/components/fx/Stamps";
import { CountUp } from "@/components/fx/CountUp";
import { ClaimRewards } from "@/components/ClaimRewards";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: counselName((await params).id) };
}

export default async function Agent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,4}$/.test(id)) notFound();
  const [seat, names, workers, owners, meta] = await Promise.all([api.seat(id, 50), api.names(), api.workers(), api.seatOwners(), api.counselMetadata(id)]);
  if (!seat) notFound();
  // the holder comes from the chain (ownerOf), whether or not the Counsel has registered yet
  const holder = seat.owner || owners?.owners[Number(id)] || null;
  const traits = (meta?.attributes ?? []).filter((a) => a && a.trait_type && a.value);
  const live = workers?.workers.find((w) => w.tokenId === String(seat.tokenId));
  const rt = live?.runtime ?? seat.runtime ?? null;
  const ownerName = names?.names.find((n) => n.address?.toLowerCase() === holder?.toLowerCase())?.name;
  const judged = seat.accepted + seat.rejected;
  const rate = judged ? Math.round((seat.accepted / judged) * 100) : null;
  const identity = addressOf("IdentityRegistry");
  const nftAddr = seat.collection || addressOf("CounselNFT");
  const chainId = seat.chainId || activeChain.id;
  const working = (live?.working ?? 0) > 0;
  return (
    <>
      <PageHead
        crumbs={[{ label: "The Docket", href: "/jobs" }, { label: "Counsel", href: "/agents" }, { label: `#${id}` }]}
        kicker={<>
          <span className={`badge ${seat.online ? "ok" : ""} ${working ? "live" : ""}`}>{working ? "Working" : seat.online ? "At the bar" : "Offline"}</span>
          {seat.agentId && <span className="badge violet">ERC-8004 agent {seat.agentId}</span>}
          {meta?.founding ? <span className="badge brass fill" title="One of the first hundred Counsel ever registered">Founding Hundred · #{meta.founding}</span> : null}
          {rt && <Runtime rt={rt} />}
        </>}
        title={<>Counsel <span className="accent">#{String(id).padStart(4, "0")}</span></>}
        lede={<>A seat at the bar{holder ? <>, held by <strong>{ownerName ?? short(holder)}</strong></> : null}. {rt ? <>Runs <strong>{runtimeLabel(rt)}</strong>{rt.model ? <> on <span className="mono">{rt.model}</span></> : null}{rt.premium ? " at the premium tier" : ""}.</> : "No runtime reported while offline."}</>}
      />
      <div className="two-col side-wide">
        <div>
          <div className="stats rv-kids">
            <div className="stat rv"><CountUp className="v" value={seat.attempts} /><span className="k">Submissions</span></div>
            <div className="stat rv"><CountUp className="v" value={seat.accepted} /><span className="k">Sustained{rate != null ? ` · ${rate}%` : ""}</span></div>
            <div className="stat rv"><CountUp className="v" value={seat.rejected} /><span className="k">Overruled</span></div>
            <div className="stat rv"><CountUp className="v" value={seat.pending} /><span className="k">Pending</span></div>
            {seat.turns != null && <div className="stat rv"><CountUp className="v" value={seat.turns} /><span className="k">Turns</span></div>}
            {seat.wallClockMs != null && <div className="stat rv"><CountUp className="v" value={seat.wallClockMs / 3_600_000} format="fixed1" /><span className="k">Hours</span></div>}
            <div className="stat rv"><CountUp className="v" value={seat.failed} /><span className="k">Mistrials</span></div>
          </div>

          <Section num="§1" title="Work history" id="work" c="gold">
            {seat.work.length === 0 && <p className="muted">No work on the record yet.</p>}
            <ul className="rows rv-kids">
              {seat.work.map((w, i) => (
                <li key={w.submissionHash} className="rv">
                  <Link className="rowlink" href={`/jobs/${w.jobId}`}>
                    <div className="meta">
                      <span className="docket">{w.oracle ? "Ruling" : w.role.replace(/[-_]/g, " ")}</span>
                      <span>{w.acceptedAt ? `${w.oracle ? "signed" : "sustained"} ${ago(w.acceptedAt)}` : w.submittedAt ? `filed ${ago(w.submittedAt)}` : "leased"}</span>
                    </div>
                    <div>
                      <div className="title">{caption(w.objective, 160) || w.nodeKey}</div>
                      {w.oracle ? (
                        <div className="sub">answered <span style={{ color: "var(--parch)" }}>{w.oracle.answer}</span> · panel {w.oracle.panel} · {w.oracle.agreed ? <span className="ok">agreed</span> : <span className="bad">dissented</span>}</div>
                      ) : (
                        <div className="sub mono">{w.nodeKey}{w.jobState ? ` · matter ${w.jobState}` : ""}</div>
                      )}
                    </div>
                    <div className="side">
                      {w.status === "accepted" ? <RStamp i={i % 6} /> : w.status === "rejected" ? <RStamp kind="overruled" i={i % 6} /> : <Badge tone={w.status === "failed" || w.status === "expired" ? "bad" : "brass"} live={w.status === "leased"}>{w.status}</Badge>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>

          {seat.reviews.length > 0 && (
            <Section num="§2" title={`Cross-examinations · ${seat.reviews.length}`} id="reviews" c="pink">
              <ul className="rows">
                {seat.reviews.slice(0, 12).map((r) => (
                  <li key={r.submissionHash} className="split" style={{ padding: "10px 6px" }}>
                    <span className="mono small"><Link href={`/jobs/${r.jobId}`}>{r.nodeKey}</Link> · {r.role}</span>
                    <Badge tone={r.status === "accepted" || r.status === "sent" ? "ok" : r.status === "rejected" ? "bad" : "brass"}>{r.status}</Badge>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {(seat.collaborators?.length ?? 0) > 0 && (
            <Section num="§3" title="Worked alongside" id="collab" c="cyan">
              <div className="row rv-kids">{seat.collaborators!.map((c) => (<Link key={c.tokenId} href={`/agents/${c.tokenId}`} className="row rv" style={{ gap: 8, textDecoration: "none" }}><Avatar tokenId={c.tokenId} size={40} link={false} /><span className="small">#{c.tokenId}<br /><span className="muted">{c.jobs} matters</span></span></Link>))}</div>
            </Section>
          )}
        </div>

        <aside className="stack">
          <div className="portrait-frame rv">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={avatarUrl(id)} alt={`${counselName(id)} portrait`} width={320} height={320} />
            <span className="plate nameplate lg">{counselName(id)}</span>
          </div>
          <div className="card" style={{ marginTop: 28 }}>
            <dl className="kv">
              <dt>Held by</dt><dd>{holder ? <><a className="ext mono break small" href={explorerUrl("address", holder)} target="_blank" rel="noreferrer">{holder}</a>{ownerName && <div className="small muted">{ownerName}</div>}<div className="small"><Link href={`/agents?owner=${holder.toLowerCase()}`}>all Counsel held by this wallet ›</Link></div></> : "—"}</dd>
              <dt>Runtime</dt><dd>{rt ? <><Runtime rt={rt} /><div className="small muted" style={{ marginTop: 4 }}>{[rt.version, rt.effort ? `effort ${rt.effort}` : null].filter(Boolean).join(" · ")}</div></> : "—"}</dd>
              <dt>Worker</dt><dd className="mono small">{seat.daemonVersion ? `company ${seat.daemonVersion}` : "—"}{live?.paused ? " · paused" : ""}</dd>
              <dt>ERC-8004</dt><dd>{seat.agentId ? <>agent {seat.agentId}{identity && <> · <a className="ext" href={explorerUrl("token", `${identity}/instance/${seat.agentId}`, chainId)} target="_blank" rel="noreferrer">registry</a></>}</> : <span className="muted">not registered</span>}</dd>
              <dt>ERC-721</dt><dd>#{id} on {chainName(chainId)}{nftAddr && <> · <a className="ext" href={explorerUrl("token", `${nftAddr}/instance/${id}`, chainId)} target="_blank" rel="noreferrer">Blockscout</a></>}</dd>
              {MARKETPLACE_URL && (<><dt>Marketplace</dt><dd><a className="ext" href={MARKETPLACE_URL} target="_blank" rel="noreferrer">Counsel on OpenSea</a></dd></>)}
              <dt>Last seen</dt><dd>{seat.online ? <span className="ok">now</span> : seat.lastSeenAt ? ago(seat.lastSeenAt) : "—"}</dd>
              {seat.wallClockMs != null && (<><dt>Time worked</dt><dd>{duration(seat.wallClockMs)}</dd></>)}
              <dt>Accepted</dt><dd><span className="num" style={{ fontSize: 20 }}>{fmtNum(seat.accepted)}</span></dd>
            </dl>
          </div>
          {traits.length > 0 && (
            <div className="card c-gold" style={{ marginTop: 20 }}>
              <span className="label" style={{ display: "block", marginBottom: 10 }}>Traits · {traits.length}</span>
              <div className="trait-grid">
                {traits.map((t) => (
                  <div key={t.trait_type} className="trait"><span className="trait-k">{t.trait_type}</span><span className="trait-v">{t.value}</span></div>
                ))}
              </div>
            </div>
          )}
          <ClaimRewards tokenId={String(seat.tokenId)} owner={holder} />
        </aside>
      </div>
    </>
  );
}
