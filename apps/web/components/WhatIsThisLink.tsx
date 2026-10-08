import Link from "next/link";

/** The "What is this?" button: a question mark plus the label (the label hides where the bar is tight). */
export function WhatIsThisLink({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <Link href="/what-is-this" className={`what-btn ${compact ? "compact" : ""} ${className}`} aria-label="What is this? A plain-language explainer" title="What is this?">
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="8" cy="8" r="6.6" />
        <path d="M6.1 6.1a1.95 1.95 0 1 1 2.6 1.84c-.45.17-.7.6-.7 1.08v.3" />
        <path d="M8 12.1h.01" strokeWidth="1.9" />
      </svg>
      <span>What is this?</span>
    </Link>
  );
}
