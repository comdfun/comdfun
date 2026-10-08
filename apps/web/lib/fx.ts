"use client";
// Confirmation for on-chain moments: a short toast at the bottom of the viewport ("Seated", "Bought back & burned").
// The same three entry points as before (gavelSlam, confetti, celebrate) so callers did not change; all of them
// now show the toast. Skipped entirely when the page is not interactive.

function toast(word: string, tone: "ok" | "over" | "sealed" = "ok") {
  if (typeof window === "undefined") return;
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const el = document.createElement("div");
  el.className = `toast toast-${tone}`;
  el.setAttribute("role", "status");
  el.textContent = word;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("in"));
  setTimeout(() => el.classList.remove("in"), 2600);
  setTimeout(() => el.remove(), 3000);
}

/** A confirmation toast (kept under its old name for the callers). */
export function gavelSlam(word = "Confirmed", tone: "ok" | "over" | "sealed" = "ok") {
  toast(word, tone);
}

/** No-op kept for callers; confirmations are toasts now. */
export function confetti(_n = 0) {
  void _n;
}

/** Transaction confirmed: show the word. */
export function celebrate(word = "Confirmed") {
  toast(word, "ok");
}
