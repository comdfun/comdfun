"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/jobs", label: "Matters", c: "cyan", m: ["/jobs", "/launches"] },
  { href: "/oracle", label: "Rulings", c: "violet", m: ["/oracle"] },
  { href: "/published", label: "Filings", c: "orange", m: ["/published"] },
  { href: "/heartbeats", label: "Retainers", c: "lime", m: ["/heartbeats"] },
  { href: "/agents", label: "Counsel", c: "gold", m: ["/agents"] },
  { href: "/today", label: "Today", c: "cyan", m: ["/today"] },
  { href: "/leaderboard", label: "Leaderboard", c: "gold", m: ["/leaderboard"] },
  { href: "/try", label: "Try it free", c: "lime", m: ["/try"] },
  { href: "/launch", label: "Retain ›", c: "pink", m: ["/launch"] },
];

export function DocketNav() {
  const p = usePathname() || "";
  return (
    <nav className="subnav" aria-label="The Docket">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} className={`c-${i.c}`} aria-current={i.m.some((m) => p === m || p.startsWith(`${m}/`)) ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
