"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// Reveal-on-scroll for `.rv` elements: a short eased rise (opacity + a few px of translate), the rubber-stamp slam,
// the wax seal, stepped meters, the quill signature. Timings come from the CSS tokens on :root (--rv-dur, --rv-stagger,
// --rv-rise, --rv-ease) so every reveal on the site moves the same way. Driven by the Web Animations API with fill
// "both", so React-owned attributes are never touched (no hydration mismatches). Elements start hidden only when the
// head script set `html.fx` (motion allowed).

const S = "steps(1, end)";

function stampFrames(rot: number): Keyframe[] {
  const r = (d: number) => `rotate(${rot + d}deg)`;
  return [
    { opacity: 0, transform: `scale(2.6) ${r(-14)}`, easing: S },
    { opacity: 0.6, transform: `scale(1.9) ${r(-8)}`, offset: 0.3, easing: S },
    { opacity: 1, transform: `scale(0.9) ${r(0)}`, offset: 0.5, easing: S },
    { opacity: 1, transform: `scale(1.06) ${r(1)} translate(-2px, 1px)`, offset: 0.62, easing: S },
    { opacity: 1, transform: `scale(1) ${r(0)} translate(2px, -1px)`, offset: 0.74, easing: S },
    { opacity: 1, transform: `scale(1) ${r(0)} translate(-1px, 0)`, offset: 0.86, easing: S },
    { opacity: 1, transform: `scale(1) ${r(0)}` },
  ];
}

const sealFrames: Keyframe[] = [
  { opacity: 0, transform: "scale(2.4) rotate(-30deg)", easing: S },
  { opacity: 1, transform: "scale(1.6) rotate(-14deg)", offset: 0.35, easing: S },
  { transform: "scale(0.86) rotate(4deg)", offset: 0.55, easing: S },
  { transform: "scale(1.08) rotate(-2deg)", offset: 0.7, easing: S },
  { transform: "scale(0.98) rotate(0)", offset: 0.85, easing: S },
  { opacity: 1, transform: "none" },
];

const num = (el: Element, v: string, d = 0) => {
  const n = parseFloat(getComputedStyle(el).getPropertyValue(v));
  return Number.isFinite(n) ? n : d;
};

/** The reveal tokens from :root, read once per pass (ms / px / easing). */
function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const ms = (v: string, d: number) => {
    const raw = cs.getPropertyValue(v).trim();
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return d;
    return raw.endsWith("ms") ? n : raw.endsWith("s") ? n * 1000 : n;
  };
  const px = (v: string, d: number) => {
    const n = parseFloat(cs.getPropertyValue(v));
    return Number.isFinite(n) ? n : d;
  };
  return { dur: ms("--rv-dur", 340), stagger: ms("--rv-stagger", 45), rise: px("--rv-rise", 10), ease: cs.getPropertyValue("--rv-ease").trim() || "cubic-bezier(0.22, 0.61, 0.36, 1)" };
}

function reveal(el: HTMLElement, t: ReturnType<typeof tokens>) {
  const i = num(el, "--i");
  const delay = i * t.stagger;
  const both = { fill: "both" as const, delay };
  if (el.classList.contains("sig-line")) {
    el.querySelector(".sig-ink")?.animate([{ strokeDashoffset: 420 }, { strokeDashoffset: 0 }], { fill: "both", duration: 2200, delay: 200, easing: "steps(28, end)" });
    return;
  }
  // the CSS fallback (rv-auto) already showed it: hold it visible, do not replay the rise
  if (getComputedStyle(el).opacity === "1") {
    el.animate([{ opacity: 1 }, { opacity: 1 }], { fill: "both", duration: 1 });
    return;
  }
  if (el.classList.contains("rstamp")) {
    el.animate(stampFrames(num(el, "--rot", -7)), { ...both, duration: 550, delay: i * 90 });
    el.querySelector(".splat")?.animate(
      [{ opacity: 0, transform: "scale(.4)", easing: S }, { opacity: 1, transform: "scale(.7)", offset: 0.5, easing: S }, { opacity: 1, transform: "scale(1)", offset: 0.7, easing: S }, { opacity: 0.85, transform: "scale(1)" }],
      { ...both, duration: 550, delay: i * 90 },
    );
    return;
  }
  if (el.classList.contains("seal")) {
    el.animate([{ opacity: 1 }, { opacity: 1 }], { fill: "both", duration: 1 });
    el.querySelector(".wax")?.animate(sealFrames, { ...both, duration: 700, delay: i * 90 });
    return;
  }
  el.animate([{ opacity: 0, transform: `translateY(${t.rise}px)` }, { opacity: 1, transform: "none" }], { ...both, duration: t.dur, easing: t.ease });
  if (el.classList.contains("meter")) {
    el.querySelector(":scope > span")?.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], { fill: "both", duration: 900, delay: delay + 120, easing: "steps(12, end)" });
  }
}

export function FxRuntime() {
  const path = usePathname();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    (window as unknown as { __companyReady?: boolean }).__companyReady = true; // the intro may now leave
  }, []);
  useEffect(() => {
    const html = document.documentElement;
    if (!html.classList.contains("fx")) return;
    // while the intro covers the page, hold reveals so they play as the doors open
    const covered = html.classList.contains("has-intro") && !html.classList.contains("intro-gone") && !html.classList.contains("intro-opening") && !html.classList.contains("intro-fade");
    if (covered && !(window as unknown as { __introReveal?: boolean }).__introReveal) {
      const again = () => setTick((t) => t + 1);
      window.addEventListener("company:intro-reveal", again, { once: true });
      return () => window.removeEventListener("company:intro-reveal", again);
    }
    const t = tokens();
    const seen = new WeakSet<Element>();
    const io =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            (entries) => {
              for (const e of entries) {
                if (e.isIntersecting) {
                  reveal(e.target as HTMLElement, t);
                  io!.unobserve(e.target);
                }
              }
            },
            { rootMargin: "0px 0px -4% 0px", threshold: 0.01 },
          )
        : null;
    const scan = (root: ParentNode) => {
      root.querySelectorAll(".rv").forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        if (io) io.observe(el);
        else reveal(el as HTMLElement, t);
      });
    };
    scan(document);
    const mo = new MutationObserver((muts) => {
      for (const m of muts) m.addedNodes.forEach((n) => n.nodeType === 1 && scan(n as Element));
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io?.disconnect();
      mo.disconnect();
    };
  }, [path, tick]);
  return null;
}
