import Link from "next/link";

const ITEMS = [
  { href: "/swap", label: "Trade", c: "gold", sub: "Pons · Uniswap" },
  { href: "/flywheel", label: "Flywheel", c: "violet", sub: "Both engines" },
];

/** The Treasury group: Trade · Flywheel (routes unchanged: /swap, /flywheel). */
export function VaultNav({ active }: { active: string }) {
  return (
    <nav className="vault-nav" aria-label="Treasury">
      <span className="vn-k">Treasury</span>
      {ITEMS.map((it) => (
        <Link key={it.href} href={it.href} className={`c-${it.c}`} aria-current={active === it.href ? "page" : undefined}>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
