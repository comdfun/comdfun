import type { Metadata } from "next";
import { PageHead } from "@/components/ui";
import { Icm } from "@/components/icm/Icm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "cICM: inference for $COMD",
  description: "Company Inference Capital Markets: one endpoint for every frontier model, paid for in $COMD. No card, no account with a model provider, and the margin published rather than discovered.",
};

export default function IcmPage() {
  return (
    <>
      {/* Crumbs and badges only: the page's own hero carries the headline, and two headlines one above the
          other made the reader choose which one to believe. */}
      <PageHead
        crumbs={[{ label: "The Docket", href: "/jobs" }, { label: "cICM" }]}
        kicker={<><span className="badge gold fill">cICM</span><span className="badge cyan">Every frontier model</span><span className="badge ok">Paid in $COMD</span><span className="badge orange">Burns $COMD</span></>}
      />
      <Icm />
    </>
  );
}
