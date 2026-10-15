import type { Metadata } from "next";
import { Icm } from "@/components/icm/Icm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Inference Markets",
  description: "Company Inference Capital Markets: one endpoint for every frontier model, paid for in $COMD. No card, no account with a model provider, and the margin published rather than discovered.",
};

export default function IcmPage() {
  return (
    <div className="wrap">
      <Icm />
    </div>
  );
}
