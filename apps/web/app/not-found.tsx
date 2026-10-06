import Link from "next/link";
import { RStamp } from "@/components/fx/Stamps";

export default function NotFound() {
  return (
    <div className="wrap" style={{ padding: "72px 16px 40px", textAlign: "center" }}>
      <div className="docket" style={{ marginBottom: 18 }}>Error 404 · Docket no. unknown</div>
      <h1 style={{ fontSize: "clamp(22px, 4vw, 40px)" }}>Not on the docket.</h1>
      <p className="muted" style={{ maxWidth: 520, margin: "0 auto 26px" }}>No record answers to that address. It may be filed under another number.</p>
      <div style={{ marginBottom: 34 }}><RStamp kind="overruled" lg>Objection sustained</RStamp></div>
      <div className="btn-row" style={{ justifyContent: "center" }}><Link className="btn primary cyan" href="/jobs">The Docket</Link><Link className="btn gold" href="/">Home</Link></div>
    </div>
  );
}
