import type { Metadata } from "next";
import { PageHead } from "@/components/ui";
import { HoldersRoom } from "@/components/room/HoldersRoom";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Holders Room",
  description: "A room for wallets holding a Counsel or $COMD: talk to the firm and to each other, and submit promotion you have published for a reward in $COMD.",
};

export default function RoomPage() {
  return (
    <>
      <PageHead
        crumbs={[{ label: "The Docket", href: "/jobs" }, { label: "Holders Room" }]}
        kicker={<><span className="badge pink fill">Holders only</span><span className="badge ok">Counsel or any $COMD</span></>}
        title={<>The <span className="accent">Holders Room</span></>}
        lede={<>Prove the wallet is yours with one signature — no transaction, no gas — and the room opens. Talk to the firm and to each other, and put up any promotion you have published: the team reads every submission, and an accepted one earns <strong>$COMD</strong>.</>}
      />
      <HoldersRoom />
    </>
  );
}
