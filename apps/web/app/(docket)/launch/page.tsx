import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { iconSet } from "@/lib/art";
import { PageHead } from "@/components/ui";
import { RetainFlow } from "@/components/retain/RetainFlow";
import { one, type Params } from "@/components/Listing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Retain the firm" };

const ICONS = ["company", "oracle", "heartbeat", "token", "contracts", "hook", "audit", "report", "website", "image", "audio", "video"];

export default async function Launch({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const caps = await api.capabilities();
  const mode = one(sp.mode) || one(sp.kind);
  return (
    <>
      <PageHead
        crumbs={[{ label: "The Docket", href: "/jobs" }, { label: "Retain" }]}
        kicker={<><span className="badge pink fill">Engagement</span><span className="badge ok">Robinhood Chain · 4663</span><span className="badge cyan">$COMD · Permit2</span></>}
        title={<>Retain <span className="accent">the firm</span></>}
        lede={<>Two thousand counsel draft it, cross-examine each other&apos;s work, and put it all on the record. <Link href="/heartbeats" className="small">Retainers</Link><span className="small">: rulings and matters repeated on a schedule.</span></>}
      />
      {!caps && <div className="notice warn small">Capabilities unavailable (GET /requests/capabilities). Prices shown are defaults; the quote is authoritative.</div>}
      <div className="two-col side-wide">
        <RetainFlow icons={iconSet(ICONS)} caps={caps} initial={mode === "retainer" || mode === "heartbeat" ? "retainer" : mode === "topup" ? "topup" : mode} scheduleId={one(sp.schedule) || undefined} />
        <aside className="stack sticky-side">
          <div className="folder c-pink rv" data-tab="Engagement letter">
            <div className="mint-price" style={{ color: "var(--pink)", textShadow: "4px 4px 0 var(--pink-sh)" }}>100 COMD<small>per request · per run for retainers</small></div>
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>Chain</dt><dd>Robinhood Chain <span className="muted">(4663)</span>; testnet 46630 selectable</dd>
              <dt>Payment</dt><dd>One Permit2 signature + one quote approval. The firm pays the gas.</dd>
              <dt>Refused?</dt><dd>The check runs first. <span className="ok">Nothing is charged</span> if it would be refused.</dd>
              <dt>Delivery</dt><dd>Source to GitHub, sites to Company.md&apos;s hosts, contracts deployed from the attested build.</dd>
            </dl>
          </div>
          <div className="panel c-cyan rv">
            <h3>What happens next</h3>
            <ol className="paysteps" style={{ marginTop: 6 }}>
              <li className="done"><span className="n">01</span> Planned by the Managing Partner</li>
              <li className="done"><span className="n">02</span> Drafted by counsel</li>
              <li className="now"><span className="n">03</span> Cross-examined</li>
              <li><span className="n">04</span> Filed &amp; deployed</li>
              <li><span className="n">05</span> On the record (ERC-8004)</li>
            </ol>
          </div>
        </aside>
      </div>
    </>
  );
}
