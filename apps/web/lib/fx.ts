"use client";
// Imperative effects for big moments: the gavel slam (with a tiny screen shake) and pixel-document confetti.
// Everything is skipped when motion is off (prefers-reduced-motion or the status-bar toggle).

const motionOff = () =>
  typeof window === "undefined" || !document.documentElement.classList.contains("fx") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function shake() {
  const h = document.documentElement;
  h.classList.remove("shake");
  void h.offsetWidth;
  h.classList.add("shake");
  setTimeout(() => h.classList.remove("shake"), 420);
}

const GAVEL = `<svg viewBox="0 0 34 18" width="100%" height="100%" shape-rendering="crispEdges" aria-hidden="true"><rect x="2" y="1" width="9" height="16" fill="#9a6234"/><rect x="2" y="1" width="2" height="16" fill="#c98a4f"/><rect x="9" y="1" width="2" height="16" fill="#3b210e"/><rect x="1" y="0" width="11" height="3" fill="#ffc83d"/><rect x="1" y="15" width="11" height="3" fill="#ffc83d"/><rect x="1" y="0" width="11" height="1" fill="#ffe598"/><rect x="11" y="8" width="22" height="3" fill="#6b3f1d"/><rect x="11" y="8" width="22" height="1" fill="#9a6234"/><rect x="31" y="7" width="3" height="5" fill="#ffc83d"/></svg>`;

/** Gavel strikes the sound block, the page shakes, a stamp lands. */
export function gavelSlam(word = "Sustained", tone: "ok" | "over" | "sealed" = "ok") {
  if (motionOff()) return;
  const el = document.createElement("div");
  el.className = "slam";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<div class="slam-box"><div class="block"></div><div class="gavel">${GAVEL}</div><div class="burst"></div><div class="word"><span class="rstamp lg ${tone === "ok" ? "" : tone}">${word}</span></div></div>`;
  document.body.appendChild(el);
  setTimeout(shake, 420);
  setTimeout(() => el.classList.add("out"), 1500);
  setTimeout(() => el.remove(), 1850);
}

const COLORS = ["#ffc83d", "#ff4fd8", "#2de2e6", "#8cff3a", "#ff8a1f", "#9b5cff", "#ff3b5c"];

/** Pixel documents fall from the top of the screen. */
export function confetti(n = 42) {
  if (motionOff()) return;
  const root = document.createElement("div");
  root.className = "confetti";
  root.setAttribute("aria-hidden", "true");
  for (let i = 0; i < n; i++) {
    const d = document.createElement("i");
    d.className = "confetto";
    const s = d.style;
    s.left = `${Math.random() * 100}%`;
    s.setProperty("--c", COLORS[i % COLORS.length]);
    s.setProperty("--dx", `${Math.round((Math.random() - 0.5) * 220)}px`);
    s.setProperty("--rot", `${Math.round((Math.random() - 0.5) * 4) * 90}deg`);
    s.setProperty("--dur", `${(1.6 + Math.random() * 1.4).toFixed(2)}s`);
    s.setProperty("--delay", `${(Math.random() * 0.6).toFixed(2)}s`);
    s.setProperty("--st", String(18 + Math.floor(Math.random() * 14)));
    if (i % 3 === 0) s.transform = "scale(1.4)";
    root.appendChild(d);
  }
  document.body.appendChild(root);
  setTimeout(() => root.remove(), 3600);
}

/** Payment admitted: slam, then the docket rains. */
export function celebrate(word = "Admitted") {
  gavelSlam(word, "ok");
  setTimeout(() => confetti(), 520);
}
