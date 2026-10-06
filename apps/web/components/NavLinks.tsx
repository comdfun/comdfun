"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectButton } from "./ConnectButton";
import { XLink } from "./XLink";
import { GitHubLink } from "./GitHubLink";
import { OpenSeaLink } from "./OpenSeaLink";
import { WhatIsThisLink } from "./WhatIsThisLink";

type Sub = { href: string; label: string; hint?: string };
type Item = { href: string; label: string; c: string; match: string[]; hint?: string; sub?: Sub[] };

/**
 * Main navigation. Desktop: the inline bar. At phone and tablet widths (globals.css, ≤ 1140px): a hamburger that opens a
 * right-hand drawer with large rows, the Treasury sub-items, the active page marked, "What is this?", Connect and the
 * X link. The drawer closes on route change, Escape, the scrim or the close button, and locks page scroll while open.
 */
export function NavLinks({ items }: { items: Item[] }) {
  const path = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const active = (it: Item) => it.match.some((m) => path === m || path.startsWith(`${m}/`));
  const close = useCallback(() => setOpen(false), []);

  // route change closes the drawer
  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    const html = document.documentElement;
    if (!open) {
      html.classList.remove("nav-open");
      return;
    }
    html.classList.add("nav-open");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => closeBtn.current?.focus(), 60);
    return () => {
      html.classList.remove("nav-open");
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
      toggle.current?.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <>
      <nav className="nav" aria-label="Main">
        {items.map((it) => (
          <Link key={it.href} href={it.href} className={`c-${it.c}`} aria-current={active(it) ? "page" : undefined}>
            {it.label}
          </Link>
        ))}
      </nav>

      {/* phone / tablet toolbar: "?" and the hamburger */}
      <div className="nav-mobile">
        <WhatIsThisLink compact className="hdr-what-m" />
        <button ref={toggle} type="button" className="nav-toggle" aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((o) => !o)}>
          <span className="burger" aria-hidden="true" />
          <span className="nav-toggle-t">Menu</span>
        </button>
      </div>

      <div className={`nav-scrim ${open ? "open" : ""}`} onClick={close} aria-hidden="true" />
      <div id="mobile-menu" className={`nav-drawer ${open ? "open" : ""}`} role="dialog" aria-modal="true" aria-label="Menu" aria-hidden={!open} inert={!open ? true : undefined}>
        <div className="nd-head">
          <span className="nd-title"><span className="dot on" /> Company.md</span>
          <button ref={closeBtn} type="button" className="nd-close" onClick={close} aria-label="Close menu">
            <svg viewBox="0 0 7 7" width="14" height="14" shapeRendering="crispEdges" aria-hidden="true">
              {[[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [6, 0], [5, 1], [4, 2], [2, 4], [1, 5], [0, 6]].map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />)}
            </svg>
          </button>
        </div>
        <nav className="nd-nav" aria-label="Main (menu)">
          <Link href="/what-is-this" className="nd-link c-gold nd-what" aria-current={path === "/what-is-this" ? "page" : undefined}>
            <span className="nd-l">What is this?</span>
            <span className="nd-h">Company.md in six steps</span>
          </Link>
          {items.map((it, i) =>
            it.sub ? (
              <div key={it.href} className={`nd-group c-${it.c}`} style={{ ["--i" as string]: i + 1 }}>
                <span className="nd-gh">{it.label}</span>
                {it.sub.map((s) => (
                  <Link key={s.href} href={s.href} className={`nd-link nd-sub c-${it.c}`} aria-current={path === s.href || path.startsWith(`${s.href}/`) ? "page" : undefined}>
                    <span className="nd-l">{s.label}</span>
                    {s.hint && <span className="nd-h">{s.hint}</span>}
                  </Link>
                ))}
              </div>
            ) : (
              <Link key={it.href} href={it.href} className={`nd-link c-${it.c}`} aria-current={active(it) ? "page" : undefined} style={{ ["--i" as string]: i + 1 }}>
                <span className="nd-l">{it.label}</span>
                {it.hint && <span className="nd-h">{it.hint}</span>}
              </Link>
            ),
          )}
          <Link href="/pair" className="nd-link c-cyan" aria-current={path === "/pair" ? "page" : undefined} style={{ ["--i" as string]: items.length + 1 }}>
            <span className="nd-l">Pair a machine</span>
            <span className="nd-h">comd start · pairing code</span>
          </Link>
        </nav>
        <div className="nd-foot">
          <ConnectButton className="btn primary block" />
          <div className="nd-social">
            <XLink label className="nd-x" />
            <GitHubLink label text="GitHub" className="nd-x nd-gh" />
            <OpenSeaLink label className="nd-x nd-os" />
          </div>
        </div>
      </div>
    </>
  );
}
