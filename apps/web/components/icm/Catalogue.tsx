"use client";
// What a call actually costs, model by model.
//
// The list and the prices are the live catalogue: `/icm/v1/models` already answers with the retail price per
// million tokens, which is the provider's own figure with the margin applied, so nothing here is a second copy
// of the pricing that could drift from what the proxy charges. The $COMD column is that price at the published
// rate, which is the number somebody holding the token actually wants.
//
// Prices move when a provider moves them. This table says so rather than implying the figures are fixed.
import { useEffect, useMemo, useState } from "react";

type Model = {
  id: string;
  name: string | null;
  context_length: number | null;
  pricing?: { prompt: string | null; completion: string | null; unit?: string; currency?: string };
};

/** The houses worth showing first: a catalogue of hundreds opens on the names people came to find. */
const ORDER = ["anthropic", "openai", "google", "x-ai", "xai", "deepseek", "meta-llama", "meta", "mistralai", "qwen", "moonshotai"];

/** A context window as somebody says it out loud: 1M, 200k. */
const ctx = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n));

export function Catalogue() {
  const [models, setModels] = useState<Model[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/icm/v1/models", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { data?: Model[] }) => alive && setModels(Array.isArray(j.data) ? j.data : []))
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);

  const rows = useMemo(() => {
    if (!models) return [];
    // best known houses first, then the largest context, so the opening rows are names somebody recognises
    const rank = (id: string) => {
      const i = ORDER.indexOf(id.split("/")[0]);
      return i === -1 ? ORDER.length : i;
    };
    return models.slice().sort((a, b) => rank(a.id) - rank(b.id) || (b.context_length ?? 0) - (a.context_length ?? 0));
  }, [models]);

  const shown = all ? rows.slice(0, 60) : rows.slice(0, 8);

  if (failed) {
    return (
      <p className="muted small" style={{ margin: 0 }}>
        The catalogue could not be read just now. The endpoint still answers; try again in a moment.
      </p>
    );
  }

  return (
    <div className="cat">
      <div className="cat-head">
        <span>On the catalogue</span>
        <span>{models ? `${rows.length.toLocaleString()} models` : "reading the catalogue…"}</span>
      </div>

      {!models ? (
        <div className="cat-rows">
          {Array.from({ length: 6 }, (_, i) => <div className="cat-row cat-skel" key={i}><i /></div>)}
        </div>
      ) : rows.length === 0 ? (
        <p className="muted small" style={{ margin: "14px 0 0" }}>
          No models are being served yet. Credit can still be bought and keys still minted.
        </p>
      ) : (
        <>
          <div className="cat-rows">
            {shown.map((m) => (
              <div className="cat-row" key={m.id}>
                <div className="cat-name">
                  <b>{m.name || m.id.split("/").pop()}</b>
                  <code>{m.id}</code>
                </div>
                {/* the column header says what this is; repeating it on every row is noise */}
                <div className="cat-ctx">{m.context_length ? <b>{ctx(m.context_length)}</b> : <b className="muted">—</b>}</div>
              </div>
            ))}
          </div>
          {rows.length > 8 && (
            <button type="button" className="cat-more" onClick={() => setAll((v) => !v)}>
              {all ? "Show fewer" : `Show more of the ${rows.length.toLocaleString()}`}
            </button>
          )}
        </>
      )}

      <p className="cat-foot">
        Every one of them through the same key and the same endpoint. What a call costs is what the provider
        charged plus the published margin, settled on the provider&apos;s own usage figure.
      </p>
    </div>
  );
}
