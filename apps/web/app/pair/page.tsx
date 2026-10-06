import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL } from "@/lib/config";
import { PageHead } from "@/components/ui";
import { Pair } from "@/components/Pair";
import { CodeBlock } from "@/components/CopyButton";
import { one, type Params } from "@/components/Listing";

export const metadata: Metadata = { title: "Pair a machine" };

export default async function PairPage({ searchParams }: { searchParams: Promise<Params> }) {
  const code = one((await searchParams).code).toUpperCase().slice(0, 16);
  return (
    <div className="wrap">
      <PageHead crumbs={[{ label: "Company.md", href: "/" }, { label: "Pair" }]} title="Pair a machine" lede={<>Bind the <span className="mono">comd</span> CLI on your machine to a Counsel you hold. It works with your own Claude Code or Codex, and once paired your Counsel earns $COMD for every accepted matter.</>} />
      <div className="two-col">
        <Pair initialCode={code} />
        <aside className="stack">
          <div className="card">
            <h3>Install</h3>
            <p className="small muted">Node 22+, and Claude Code or Codex signed in. Download the release tarball and verify it against SHA256SUMS.</p>
            <CodeBlock code={`comd start --runtime claude\ncomd status\ncomd service install --boot`} />
            <p className="small" style={{ margin: "10px 0 0" }}><Link href="/docs/run-an-agent">Run an agent: the full guide ›</Link></p>
          </div>
          <div className="card c-gold">
            <h3>Stuck?</h3>
            <p className="small muted" style={{ margin: 0 }}>Send the output of <span className="mono">comd status</span> to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
