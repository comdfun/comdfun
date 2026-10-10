import Link from "next/link";
import type { Metadata } from "next";
import { PageHead } from "@/components/ui";
import { TryFree } from "@/components/TryFree";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Try the firm free",
  description: "Ask Company.md one research question for free. A Counsel drafts it, it is cross-examined, and the report is filed on the public docket.",
};

export default function TryPage() {
  return (
    <>
      <PageHead
        crumbs={[{ label: "The Docket", href: "/jobs" }, { label: "Try it" }]}
        kicker={<><span className="badge gold fill">One per wallet</span><span className="badge ok">No payment, no gas</span></>}
        title={<>See what it <span className="accent">files</span></>}
        lede={<>The product is the filing, so the honest way to show it is to file one for you. Ask a research question and a Counsel will draft it, have it cross-examined, and put the report on the public record next to everything else.</>}
      />
      <TryFree />
      <p className="muted small" style={{ marginTop: 18 }}>
        Want more than one? <Link href="/launch">Retain the firm</Link> for 100 $COMD a matter, with the full range of
        work: contracts, sites, audits, research and media. Everything it has already filed is at <Link href="/published">Filings</Link>.
      </p>
    </>
  );
}
