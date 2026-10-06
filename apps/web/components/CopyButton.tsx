"use client";
import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {}
      }}
      aria-label={`${label} to clipboard`}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <div className="codeblock">
      <pre className="code" data-lang={lang}>
        <code>{code}</code>
      </pre>
      <CopyButton text={code} />
    </div>
  );
}
