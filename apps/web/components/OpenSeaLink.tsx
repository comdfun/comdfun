import { MARKETPLACE_URL } from "@/lib/config";


export function OpenSeaLink({ className = "", label = false, text = "OpenSea" }: { className?: string; label?: boolean; text?: string }) {
  if (!MARKETPLACE_URL) return null;
  return (
    <a className={`xlink oslink ${className}`} href={MARKETPLACE_URL} target="_blank" rel="noreferrer" aria-label="The Counsel collection on OpenSea" title="Counsel on OpenSea">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
        <path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0m-5.3 12.4 1.86-2.92a.1.1 0 0 1 .18.02c.5 1.12.93 2.5.73 3.37-.09.35-.32.83-.58 1.27a1 1 0 0 1-.1.17.1.1 0 0 1-.9.05H6.78a.1.1 0 0 1-.08-.15m12.9 1.56c0 .06-.3.11-.9.14-.3.13-1.17.53-1.17.53-.57.25-1.07.6-1.48 1.05-.63.7-1.11 1.6-2.2 1.6H9.56a3.34 3.34 0 0 1-3.33-3.35v-.14a.14.14 0 0 1 .14-.13h2.07c.09 0 .16.07.16.16v.5c0 .3.24.54.54.54h1.1v-2.1H9.17a9.6 9.6 0 0 1 1.63-2.36l.09-.1a.1.1 0 0 0 .02-.06V9.7a.1.1 0 0 0-.1-.1H9.37a.1.1 0 0 1-.07-.17l.68-.68a.1.1 0 0 1 .07-.03h1.37a.1.1 0 0 0 .1-.1V7.16a.2.2 0 0 1 .2-.2h.73c.1 0 .2.09.2.2v2.84c0 .07.03.13.08.17.3.23 1.26 1.03 1.6 2.13.8 2.53.1 3.57-.17 3.96a.1.1 0 0 0 .8.16h1.34c.26 0 .5-.1.69-.28l1.26-1.2a.2.2 0 0 1 .14-.06h1.6c.09 0 .16.07.16.16z" />
      </svg>
      {label && <span>{text}</span>}
    </a>
  );
}
