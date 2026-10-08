// Inline <head> scripts (plain strings; must not live in a "use client" module).

/** Runs before first paint: the motion preference (reduced motion, or the saved "off"). */
export const HEAD_SCRIPT_PREFS = `(function(){try{var d=document.documentElement,s=localStorage;var m=s.getItem("company.motion");var r=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;if(m!=="off"&&!r){d.classList.add("fx")}else{d.classList.add("no-motion")}}catch(e){document.documentElement.classList.add("fx")}})();`;
