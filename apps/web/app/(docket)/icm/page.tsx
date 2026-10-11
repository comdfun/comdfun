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
      <PageHead
        crumbs={[{ label: "The Docket", href: "/jobs" }, { label: "cICM" }]}
        kicker={<><span className="badge gold fill">cICM</span><span className="badge cyan">Every frontier model</span><span className="badge ok">Paid in $COMD</span></>}
        title={<>Inference, <span className="accent">bought with $COMD</span></>}
        lede={<>Company Inference Capital Markets. Send $COMD, get an API key, and point your client at one endpoint that reaches every frontier model. You pay what the model provider charged plus a published margin, and every call is on a ledger you can read.</>}
      />
      <Icm />
    </>
  );
}
