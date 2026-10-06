// Small presentational pieces shared by every page. Server components (no hooks).
import Link from "next/link";
import type { ReactNode } from "react";
import { avatarUrl } from "@/lib/links";
import { explorerUrl } from "@/lib/chains";
import { short, counselName } from "@/lib/format";
import { WaxSvg } from "./fx/Stamps";

export function PageHead({ crumbs, title, lede, children, kicker }: { crumbs?: { href?: string; label: string }[]; title: ReactNode; lede?: ReactNode; children?: ReactNode; kicker?: ReactNode }) {
  return (
    <div className="page-head">
      {crumbs && (
        <nav className="crumbs rv" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 && <span className="sep" aria-hidden="true">›</span>}
              {c.href ? <Link href={c.href}>{c.label}</Link> : c.label}
            </span>
          ))}
        </nav>
      )}
      {kicker && <div className="ph-docket rv">{kicker}</div>}
      {title ? <h1 className="rv">{title}</h1> : null}
      {lede && <p className="lede rv" style={{ ["--i" as string]: 1 }}>{lede}</p>}
      {children}
    </div>
  );
}

export function Avatar({ tokenId, size = 24, link = true }: { tokenId: string | number; size?: number; link?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img className={size >= 40 ? "av lg" : "av"} style={{ width: size, height: size }} src={avatarUrl(tokenId)} alt={counselName(tokenId)} loading="lazy" width={size} height={size} />;
  return link ? <Link href={`/agents/${tokenId}`} title={counselName(tokenId)}>{img}</Link> : img;
}

export function Avatars({ ids, max = 6, link = false }: { ids: (string | number)[]; max?: number; link?: boolean }) {
  const uniq = [...new Set(ids.map(String))];
  if (!uniq.length) return null;
  return (
    <span className="avs">
      {uniq.slice(0, max).map((id) => (
        <Avatar key={id} tokenId={id} link={link} />
      ))}
      {uniq.length > max && <span className="more">+{uniq.length - max}</span>}
    </span>
  );
}

export function Badge({ tone, children, title, live, fill }: { tone?: "brass" | "ok" | "bad" | "muted" | "cyan" | "violet" | "pink" | "orange" | "sig"; children: ReactNode; title?: string; live?: boolean; fill?: boolean }) {
  return (
    <span className={`badge ${tone && tone !== "muted" ? tone : ""} ${live ? "live" : ""} ${fill ? "fill" : ""}`} title={title}>
      {children}
    </span>
  );
}

export function Seal({ label = "Sealed", big, tone = "crimson" }: { label?: string; big?: boolean; tone?: "crimson" | "violet" | "gold" }) {
  return (
    <span className={`seal rv ${big ? "big" : ""}`}>
      <span className="wax"><WaxSvg tone={tone} /></span>
      {label}
    </span>
  );
}

export function Addr({ a, chainId, kind = "address", full }: { a?: string | null; chainId?: number; kind?: "address" | "tx" | "token"; full?: boolean }) {
  if (!a) return <span className="muted">—</span>;
  return (
    <a className="mono ext nowrap" href={explorerUrl(kind, a, chainId)} target="_blank" rel="noreferrer" title={a}>
      {full ? a : short(a)}
    </a>
  );
}

export function Owner({ a, names }: { a?: string | null; names?: Map<string, string> }) {
  if (!a) return <span className="muted">—</span>;
  const n = names?.get(a.toLowerCase());
  return (
    <a className="mono ext" href={explorerUrl("address", a)} target="_blank" rel="noreferrer" title={a}>
      {n ?? short(a)}
    </a>
  );
}

export function Section({ num, title, children, id, right, c }: { num?: string; title: ReactNode; children: ReactNode; id?: string; right?: ReactNode; c?: string }) {
  return (
    <section className={`section ${c ? `c-${c}` : ""}`} id={id} aria-labelledby={id ? `${id}-h` : undefined}>
      <div className="section-title rv">
        {num && <span className="num">{num}</span>}
        <h2 id={id ? `${id}-h` : undefined}>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty rv">
      <span className="px">{title}</span>
      {children}
    </div>
  );
}

export function OffRecord({ what }: { what: string }) {
  return (
    <div className="notice warn" role="alert">
      <span className="px tx-orange" style={{ fontSize: 11, fontWeight: 700 }}>Off the record.</span> The docket could not be read ({what}). The control plane may be down; this page retries every 10 seconds.
    </div>
  );
}

export function InRe({ text, href }: { text: string; href?: string }) {
  const body = (
    <span className="caption-in-re">
      <span className="inre">In re:</span>
      {text}
    </span>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Stamp({ children, red, c }: { children: ReactNode; red?: boolean; c?: string }) {
  return <span className={`stamp ${red ? "red" : ""} ${c ? `c-${c}` : ""}`}>{children}</span>;
}

/** Runtime chip: Claude Code / Codex · model id · premium tier. */
export function Runtime({ rt, compact }: { rt?: { name: string; model: string | null; version?: string | null; premium?: boolean } | null; compact?: boolean }) {
  if (!rt) return <span className="muted">—</span>;
  const n = rt.name.toLowerCase();
  const cls = n.includes("claude") ? "claude" : n.includes("codex") ? "codex" : "mock";
  const label = cls === "claude" ? "Claude Code" : cls === "codex" ? "Codex" : rt.name;
  return (
    <span className={`rt ${cls}`} title={[label, rt.version, rt.model, rt.premium ? "premium" : null].filter(Boolean).join(" · ")}>
      <span className="rt-n">{label}</span>
      {rt.model && !compact && <span className="rt-m">{rt.model}</span>}
      {rt.premium && <span className="rt-p">Premium</span>}
    </span>
  );
}
