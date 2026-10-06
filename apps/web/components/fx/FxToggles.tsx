"use client";
import { useEffect, useState } from "react";

type Prefs = { crt: boolean; motion: boolean; cursor: boolean };

function read(): Prefs {
  const d = document.documentElement;
  return { crt: d.getAttribute("data-crt") !== "off", motion: d.classList.contains("fx"), cursor: d.getAttribute("data-cursor") === "pixel" };
}

/** Status-bar switches for the CRT overlay, motion and the pixel cursor. Persisted per browser. */
export function FxToggles() {
  const [p, setP] = useState<Prefs | null>(null);
  useEffect(() => setP(read()), []);
  if (!p) return null;
  const save = (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  };
  const d = document.documentElement;
  return (
    <span className="row" style={{ gap: 6 }} aria-label="Display effects">
      <button type="button" className="fxbtn" aria-pressed={p.crt} title="CRT scanlines" onClick={() => { const on = !p.crt; d.setAttribute("data-crt", on ? "on" : "off"); save("company.crt", on ? "on" : "off"); setP({ ...p, crt: on }); }}>CRT</button>
      <button type="button" className="fxbtn" aria-pressed={p.motion} title="Animation" onClick={() => { const on = !p.motion; d.classList.toggle("fx", on); d.classList.toggle("no-motion", !on); save("company.motion", on ? "on" : "off"); setP({ ...p, motion: on }); }}>Motion</button>
      <button type="button" className="fxbtn hide-sm" aria-pressed={p.cursor} title="Pixel cursor" onClick={() => { const on = !p.cursor; if (on) d.setAttribute("data-cursor", "pixel"); else d.removeAttribute("data-cursor"); save("company.cursor", on ? "pixel" : "default"); setP({ ...p, cursor: on }); }}>Cursor</button>
    </span>
  );
}
