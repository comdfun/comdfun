import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui";
import { HolderHome } from "@/components/HolderHome";

export const metadata: Metadata = { title: "My Counsel" };

/** Holder home: what you hold, what each Counsel still needs, what it has earned. */
export default function MePage() {
  return (
    <div className="wrap">
      <PageHead
        crumbs={[{ label: "Company.md", href: "/" }, { label: "My Counsel" }]}
        title={<>My <span className="accent">Counsel</span></>}
        lede={<>Every Counsel you hold, in one place: <strong>register</strong> it (one transaction), <strong>pair</strong> a machine, and it starts earning <strong>$COMD</strong> for accepted work. Rewards are claimed here, per seat. Missed the mint? <a href="https://opensea.io/collection/counsel-362029053" target="_blank" rel="noreferrer">Counsel trade on OpenSea</a>.</>}
      >
        <p className="small muted" style={{ margin: 0 }}>Contract owner? The mint controls are still on <Link href="/mint">/mint</Link>.</p>
      </PageHead>
      <HolderHome />
    </div>
  );
}
