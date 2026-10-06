import Link from "next/link";
import { notFound } from "next/navigation";
import { DOCS, DOC_BY_SLUG } from "@/lib/docs/pages";
import { renderMd } from "@/lib/md";
import { ADDRESS_BOOK, addressOf, keyOf } from "@/lib/contracts";
import { api } from "@/lib/api";
import { comd } from "@/lib/format";
import { DEFAULT_PRICE } from "@/lib/config";
import { ContactBlock } from "@/components/Footer";

const ROLE: Record<string, string> = {
  ComdToken: "$COMD, the token", ComdTaxHook: "v4 hook: 5% ETH tax, inventory cap, trims and their split", ComdRouter: "Swaps and quotes", Flywheel: "Tax buckets: buyback-and-burn, Counsel floor sweeps",
  BuyWall: "Trim ETH posted as a bid under the price", StakedComd: "sCOMD, the staking vault (ERC-4626)", RewardDripper: "Streams staker rewards into sCOMD", Bond: "Sells the bond reserve for ETH",
  CounselNFT: "Company.md Counsel (ERC-721)", IdentityRegistry: "ERC-8004 identities", RevenueRouter: "Job payments: 80% Counsel / 20% firm", RewardDistributor: "Counsel rewards by epoch (COMD)",
  ContributorDistributor: "Launch contributor claims", Incorporations: "Company coins", Permit2: "Uniswap Permit2 (payments)", WETH: "Wrapped ether",
};

const ORDER = [...DOCS.slice(0, DOCS.findIndex((d) => d.slug === "contracts") + 1).map((d) => d.slug), "api", ...DOCS.slice(DOCS.findIndex((d) => d.slug === "contracts") + 1).map((d) => d.slug)];
const hrefOf = (slug: string) => (slug === "introduction" ? "/docs" : `/docs/${slug}`);
const titleOf = (slug: string) => (slug === "api" ? "API reference" : DOC_BY_SLUG.get(slug)?.title ?? slug);

export function PrevNext({ slug }: { slug: string }) {
  const i = ORDER.indexOf(slug);
  const prev = i > 0 ? ORDER[i - 1] : null;
  const next = i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null;
  return (
    <nav className="docs-pn" aria-label="Previous and next">
      {prev ? <Link href={hrefOf(prev)} className="pn prev"><span>‹ Previous</span><b>{titleOf(prev)}</b></Link> : <span />}
      {next ? <Link href={hrefOf(next)} className="pn next"><span>Next ›</span><b>{titleOf(next)}</b></Link> : <span />}
    </nav>
  );
}

export async function DocView({ slug }: { slug: string }) {
  const doc = DOC_BY_SLUG.get(slug);
  if (!doc) notFound();
  let md = doc.md;
  if (md.includes("{{price}}")) {
    const caps = await api.capabilities();
    const amt = caps?.actions.find((a) => a.action === "job.open")?.payment.amount;
    md = md.replaceAll("{{price}}", `${comd(BigInt(amt ?? DEFAULT_PRICE))} COMD`);
  }
  if (md.includes("{{contracts}}")) {
    const rows = ADDRESS_BOOK.map((n) => {
      const a = addressOf(n, 4663);
      return `| ${n} | \`${keyOf(n)}\` | ${ROLE[n] ?? ""} | ${a ? `[\`${a}\`](https://robinhoodchain.blockscout.com/address/${a})` : "not deployed yet"} |`;
    });
    md = md.replace("{{contracts}}", ["| Contract | Key | Role | Robinhood Chain (4663) |", "|---|---|---|---|", ...rows].join("\n"));
  }
  const { nodes, headings } = renderMd(md);
  return (
    <div className="doc">
      <article className="doc-body">
        <div className="crumbs"><Link href="/docs">Docs</Link><span className="sep">›</span><span>{doc.group}</span></div>
        <h1>{doc.title}</h1>
        <p className="lede">{doc.summary}</p>
        <div className="doc-md">{nodes}</div>
        {slug === "contact" && <div style={{ marginTop: 20 }}><ContactBlock big /></div>}
        <PrevNext slug={slug} />
      </article>
      {headings.length > 1 && (
        <nav className="doc-toc" aria-label="On this page">
          <div className="label">On this page</div>
          {headings.filter((h) => h.level === 2).map((h) => <a key={h.id} href={`#${h.id}`}>{h.text}</a>)}
        </nav>
      )}
    </div>
  );
}
