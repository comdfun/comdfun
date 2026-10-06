"use client";
import type { ChangeEvent } from "react";

/**
 * The statement of the matter: a charcoal case-file dossier around a textarea. Tab and focus glow take the
 * section's signature colour; the footer carries a pixel caret, a hint and a character counter.
 */
export function CaseField({ id, value, onChange, placeholder, max = 8000, rows = 6, tab = "Statement of the matter", head = "In re:", right, hint, c }: {
  id: string; value: string; onChange: (v: string) => void; placeholder?: string; max?: number; rows?: number; tab?: string; head?: string; right?: string; hint?: string; c?: string;
}) {
  const n = value.length;
  const cls = n >= max ? "full" : n > max * 0.9 ? "near" : "";
  return (
    <div className={`dossier ${c ? `c-${c}` : ""}`} data-tab={tab}>
      <div className="dossier-head">
        <label className="eng" htmlFor={id}>{head}</label>
        <span className="eng-r">{right ?? "Docket no. pending"}</span>
      </div>
      <div className="dossier-body">
        <textarea id={id} rows={rows} maxLength={max} value={value} placeholder={placeholder} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)} spellCheck />
      </div>
      <div className="dossier-foot">
        <span><span className="pcaret" aria-hidden="true" />{hint ?? "Be specific: counsel build exactly what you write"}</span>
        <span className={`count ${cls}`} aria-live="polite">{n.toLocaleString("en-US")} / {max.toLocaleString("en-US")}</span>
      </div>
    </div>
  );
}
