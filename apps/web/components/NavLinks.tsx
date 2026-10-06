"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

type Item = { href: string; label: string; c: string; match: string[]; sub?: { href: string; label: string }[] };

export function NavLinks({ items }: { items: Item[] }) {
  const path = usePathname() || "/";
  const det = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (det.current) det.current.open = false;
  }, [path]);
  const active = (it: Item) => it.match.some((m) => path === m || path.startsWith(`${m}/`));
  return (
    <>
      <nav className="nav" aria-label="Main">
        {items.map((it) => (
          <Link key={it.href} href={it.href} className={`c-${it.c}`} aria-current={active(it) ? "page" : undefined}>
            {it.label}
          </Link>
        ))}
      </nav>
      <details className="nav-toggle" ref={det}>
        <summary aria-label="Menu">Menu</summary>
        <nav className="menu" aria-label="Main (mobile)">
          {items.map((it) =>
            it.sub ? (
              <div key={it.href} className={`menu-group c-${it.c}`}>
                <span className="menu-h">{it.label}</span>
                {it.sub.map((s) => (
                  <Link key={s.href} href={s.href} className={`c-${it.c}`} aria-current={path === s.href ? "page" : undefined}>{s.label}</Link>
                ))}
              </div>
            ) : (
              <Link key={it.href} href={it.href} className={`c-${it.c}`} aria-current={active(it) ? "page" : undefined}>
                {it.label}
              </Link>
            ),
          )}
          <Link href="/pair" className="c-cyan">Pair a machine</Link>
        </nav>
      </details>
    </>
  );
}
