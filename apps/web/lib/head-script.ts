// Inline <head> scripts (plain strings; must not live in a "use client" module).

/** Runs before first paint: motion + CRT + cursor preferences. */
export const HEAD_SCRIPT_PREFS = `(function(){try{var d=document.documentElement,s=localStorage;var m=s.getItem("company.motion");var r=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;if(m!=="off"&&!r){d.classList.add("fx")}else{d.classList.add("no-motion")}var c=s.getItem("company.crt");d.setAttribute("data-crt",c==="off"?"off":"on");if(s.getItem("company.cursor")==="pixel")d.setAttribute("data-cursor","pixel")}catch(e){document.documentElement.classList.add("fx")}})();`;
