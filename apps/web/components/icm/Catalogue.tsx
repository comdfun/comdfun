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

const money = (v: number) =>
  v >= 100 ? v.toFixed(0)
  : v >= 1 ? v.toFixed(2)
  : v >= 0.01 ? v.toFixed(3)
  : v.toPrecision(2);

export function Catalogue({ tokensPerUsd }: { tokensPerUsd: number | null }) {
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
    const priced = models.filter((m) => m.pricing?.completion && Number(m.pricing.completion) > 0);
    // best known houses first, then by price, so the opening rows are names somebody recognises
    const rank = (id: string) => {
      const house = id.split("/")[0];
      const i = ORDER.indexOf(house);
      return i === -1 ? ORDER.length : i;
    };
    return priced.sort((a, b) => rank(a.id) - rank(b.id) || Number(b.pricing!.completion) - Number(a.pricing!.completion));
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
        <span>Output price · per 1M tokens</span>
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
            {shown.map((m) => {
              const usd = Number(m.pricing!.completion);
              const comd = tokensPerUsd ? usd * tokensPerUsd : null;
              return (
                <div className="cat-row" key={m.id}>
                  <div className="cat-name">
                    <b>{m.name || m.id.split("/").pop()}</b>
                    <code>{m.id}</code>
                  </div>
                  <div className="cat-price">
                    <b>${money(usd)}</b>
                    {comd !== null && <span>{Math.round(comd).toLocaleString()} $COMD</span>}
                  </div>
                </div>
              );
            })}
          </div>
          {rows.length > 8 && (
            <button type="button" className="cat-more" onClick={() => setAll((v) => !v)}>
              {all ? "Show fewer" : `Show more of the ${rows.length.toLocaleString()}`}
            </button>
          )}
        </>
      )}

      <p className="cat-foot">
        What you are charged, which is what the provider charged plus the published margin. Input tokens are
        priced separately and usually cost less. Providers change their prices; these follow them.
      </p>
    </div>
  );
}
