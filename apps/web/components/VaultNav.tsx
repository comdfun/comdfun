import Link from "next/link";

const ITEMS = [
  { href: "/swap", label: "Swap", c: "gold", sub: "ETH ↔ COMD" },
  { href: "/stake", label: "Stake", c: "cyan", sub: "sCOMD" },
  { href: "/bond", label: "Bond", c: "orange", sub: "ETH → COMD" },
  { href: "/flywheel", label: "Flywheel", c: "violet", sub: "Both engines" },
];

/** The Vault group: Swap · Stake · Bond · Flywheel. */
export function VaultNav({ active }: { active: string }) {
  return (
    <nav className="vault-nav" aria-label="Vault">
      <span className="vn-k">Vault</span>
      {ITEMS.map((it) => (
        <Link key={it.href} href={it.href} className={`c-${it.c}`} aria-current={active === it.href ? "page" : undefined}>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
