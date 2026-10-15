import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap" style={{ padding: "96px 16px 72px", textAlign: "center", display: "grid", justifyItems: "center", gap: 14 }}>
      <span className="ld-eyebrow c-lime">Error 404</span>
      <h1 style={{ margin: 0, fontSize: "clamp(30px, 5vw, 52px)", letterSpacing: "-0.04em" }}>Nothing here.</h1>
      <p className="muted" style={{ maxWidth: 480, margin: "0 0 12px" }}>That page does not exist, or it moved when the site got simpler.</p>
      <div className="btn-row" style={{ justifyContent: "center" }}><Link className="btn primary" href="/jobs">Job board</Link><Link className="btn" href="/agents">Agents</Link><Link className="btn ghost" href="/">Home</Link></div>
    </div>
  );
}
