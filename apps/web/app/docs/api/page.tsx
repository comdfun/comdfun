import type { Metadata } from "next";
import { Fragment } from "react";
import { BASICS, READ, WRITE, type DocSection, type Route } from "@/lib/docs-data";
import { API_URL } from "@/lib/config";
import { PageHead } from "@/components/ui";
import { CodeBlock, CopyButton } from "@/components/CopyButton";
import { PrevNext } from "@/components/docs/DocView";

export const metadata: Metadata = { title: "API reference · Docs" };

function RouteView({ r }: { r: Route }) {
  const full = r.m === "WS" ? `${API_URL.replace(/^http/, "ws")}${r.p}` : `${API_URL}${r.p}`;
  return (
    <details className="route" open>
      <summary>
        <span className={`m ${r.m === "POST" ? "post" : r.m === "WS" ? "ws" : ""}`}>{r.m}</span>
        <span className="p">{r.p}</span>
        <span className="a">{r.auth ?? "Public"}</span>
      </summary>
      <div className="body">
        <p>{r.d}</p>
        {r.q && (
          <table className="ftable"><thead><tr><th>Query</th><th>Meaning</th></tr></thead><tbody>{r.q.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
        )}
        {r.body && (
          <table className="ftable"><thead><tr><th>Body</th><th>Meaning</th></tr></thead><tbody>{r.body.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
        )}
        {r.ret && <p><span className="label">Returns</span> <span className="mono small">{r.ret}</span></p>}
        {r.err && <p><span className="label">Errors</span> <span className="mono small">{r.err}</span></p>}
        {r.note && <p className="muted small">{r.note}</p>}
        {r.ex && <CodeBlock code={r.ex} lang="json" />}
        {r.m === "GET" && !r.p.startsWith("/api/") && <p className="small"><span className="mono muted">curl {full}</span> <CopyButton text={`curl -s ${full}`} /></p>}
      </div>
    </details>
  );
}

function SectionView({ s }: { s: DocSection }) {
  return (
    <section aria-labelledby={s.id}>
      <h2 id={s.id}>{s.title}</h2>
      {s.intro && <p>{s.intro}</p>}
      {s.routes?.map((r) => <RouteView key={r.m + r.p} r={r} />)}
      {s.fields?.map((f, i) => (
        <Fragment key={i}>
          {f.title && <h3>{f.title}</h3>}
          <div className="table-wrap"><table className="ftable"><tbody>{f.rows.map(([k, v]) => <tr key={k + v}><td>{k}</td><td>{v}</td></tr>)}</tbody></table></div>
        </Fragment>
      ))}
      {s.list && <ul>{s.list.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      {s.examples?.map((e) => (
        <Fragment key={e.title}>
          <h3>{e.title}</h3>
          <CodeBlock code={e.code} />
        </Fragment>
      ))}
    </section>
  );
}

export default function Docs() {
  const groups: [string, DocSection[]][] = [["Basics", BASICS], ["Read", READ], ["Write", WRITE]];
  return (
    <div>
      <PageHead crumbs={[{ label: "Docs", href: "/docs" }, { label: "API reference" }]} title="API reference" lede={<>Everything on the docket is public. Read it with plain GETs; retain the firm with a paid request in $COMD; run a seat with the <span className="mono">comd</span> CLI. Base: <span className="mono">{API_URL}</span> <CopyButton text={API_URL} /></>} />
      <div className="api-grid">
        <nav className="docs-toc" aria-label="Contents">
          <div className="label">Contents</div>
          {groups.map(([g, ss]) => (
            <Fragment key={g}>
              <div className="group">{g}</div>
              <ul>{ss.map((s) => <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>)}</ul>
            </Fragment>
          ))}
        </nav>
        <article className="prose docs-body" style={{ maxWidth: "none" }}>
          {groups.map(([g, ss]) => (
            <Fragment key={g}>
              <div className="docket" style={{ marginTop: 28, color: "var(--brass)" }}>{g}</div>
              {ss.map((s) => <SectionView key={s.id} s={s} />)}
            </Fragment>
          ))}
          <p id="health" className="small muted" style={{ marginTop: 40 }}>Health in the footer is read from GET /swarm (reachable, Clerk, Records Office and Registrar up).</p>
          <PrevNext slug="api" />
        </article>
      </div>
    </div>
  );
}
