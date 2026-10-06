"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// Reveal-on-scroll for `.rv` elements: pixel dissolve, rubber-stamp slam, wax seal, stepped meters, the quill
// signature. Driven by the Web Animations API with fill "both", so React-owned attributes are never touched
// (no hydration mismatches). Elements start hidden only when the head script set `html.fx` (motion allowed).

const svgMask = (rects: string) => `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E${rects}%3C/svg%3E")`;
const M1 = svgMask("%3Crect width='4' height='4'/%3E");
const M2 = svgMask("%3Crect width='4' height='4'/%3E%3Crect x='4' y='4' width='4' height='4'/%3E");
const M3 = svgMask("%3Crect width='8' height='4'/%3E%3Crect x='4' y='4' width='4' height='4'/%3E");
const S = "steps(1, end)";

const dissolve: Keyframe[] = [
  { opacity: 1, maskImage: M1, WebkitMaskImage: M1, maskSize: "8px 8px", WebkitMaskSize: "8px 8px", transform: "translateY(8px)", easing: S } as Keyframe,
  { opacity: 1, maskImage: M2, WebkitMaskImage: M2, maskSize: "8px 8px", WebkitMaskSize: "8px 8px", transform: "translateY(4px)", offset: 0.33, easing: S } as Keyframe,
  { opacity: 1, maskImage: M3, WebkitMaskImage: M3, maskSize: "8px 8px", WebkitMaskSize: "8px 8px", transform: "translateY(0)", offset: 0.66, easing: S } as Keyframe,
  { opacity: 1, maskImage: "none", WebkitMaskImage: "none", transform: "none" } as Keyframe,
];

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

function reveal(el: HTMLElement) {
  const delay = num(el, "--i") * 70;
  const both = { fill: "both" as const, delay };
  if (el.classList.contains("rstamp")) {
    el.animate(stampFrames(num(el, "--rot", -7)), { ...both, duration: 550, delay: num(el, "--i") * 90 });
    el.querySelector(".splat")?.animate(
      [{ opacity: 0, transform: "scale(.4)", easing: S }, { opacity: 1, transform: "scale(.7)", offset: 0.5, easing: S }, { opacity: 1, transform: "scale(1)", offset: 0.7, easing: S }, { opacity: 0.85, transform: "scale(1)" }],
      { ...both, duration: 550, delay: num(el, "--i") * 90 },
    );
    return;
  }
  if (el.classList.contains("seal")) {
    el.animate([{ opacity: 1 }, { opacity: 1 }], { fill: "both", duration: 1 });
    el.querySelector(".wax")?.animate(sealFrames, { ...both, duration: 700, delay: num(el, "--i") * 90 });
    return;
  }
  if (el.classList.contains("sig-line")) {
    el.querySelector(".sig-ink")?.animate([{ strokeDashoffset: 420 }, { strokeDashoffset: 0 }], { fill: "both", duration: 2200, delay: 200, easing: "steps(28, end)" });
    return;
  }
  el.animate(dissolve, { ...both, duration: 420 });
  if (el.classList.contains("meter")) {
    el.querySelector(":scope > span")?.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], { fill: "both", duration: 900, delay: delay + 150, easing: "steps(12, end)" });
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
    // while the intro covers the page, hold reveals so they play when the doors open
    if (html.classList.contains("has-intro") && !html.classList.contains("intro-gone")) {
      const again = () => setTick((t) => t + 1);
      window.addEventListener("company:intro-done", again, { once: true });
      return () => window.removeEventListener("company:intro-done", again);
    }
    const seen = new WeakSet<Element>();
    const io =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            (entries) => {
              for (const e of entries) {
                if (e.isIntersecting) {
                  reveal(e.target as HTMLElement);
                  io!.unobserve(e.target);
                }
              }
            },
            { rootMargin: "0px 0px -6% 0px", threshold: 0.01 },
          )
        : null;
    const scan = (root: ParentNode) => {
      root.querySelectorAll(".rv").forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        if (io) io.observe(el);
        else reveal(el as HTMLElement);
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
