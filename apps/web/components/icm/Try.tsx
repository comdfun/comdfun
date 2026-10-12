"use client";
// Try a model, then take the code with you.
//
// The playground calls the public endpoint directly from this tab, streamed, with a key the visitor pastes in.
// The key is held in component state only: never stored, never sent anywhere but the endpoint. What the call
// cost is read from the stream's own usage frame, which states the price the caller is charged.
//
// The quickstart below it is the same request in four shapes, with the model picked above filled in.
import { useEffect, useRef, useState } from "react";
import { CopyButton } from "@/components/CopyButton";

const MOCK = process.env.NEXT_PUBLIC_MOCK === "1" || process.env.NEXT_PUBLIC_MOCK === "true";
const PREFERRED = ["anthropic/claude-sonnet-4", "openai/gpt-5-mini", "google/gemini-2.5-flash", "anthropic/claude-opus-4.1", "openai/gpt-5"];
const PROMPT = "In two sentences: why does burning a token on every purchase tie its demand to real usage?";

type Model = { id: string; name?: string };
type Run = { text: string; model: string | null; tokensIn: number | null; tokensOut: number | null; cost: number | null; firstMs: number | null; totalMs: number | null; error: string | null; busy: boolean };
const EMPTY: Run = { text: "", model: null, tokensIn: null, tokensOut: null, cost: null, firstMs: null, totalMs: null, error: null, busy: false };

/** What a refusal from the endpoint means, in the visitor's terms. */
function why(status: number, body: string): string {
  let msg = "";
  try { const j = JSON.parse(body) as { error?: { message?: string } | string; detail?: string }; msg = (typeof j.error === "object" ? j.error?.message : j.error) || j.detail || ""; } catch { /* not JSON */ }
  if (status === 401) return "That key was not recognised. Paste a key from your account below, exactly as it was shown.";
  if (status === 402) return msg || "This key has no credit left to spend. Put credit on the account, or raise the key's ceiling.";
  if (status === 429) return "Too many calls at once. Wait a moment and run it again.";
  return msg || `The endpoint answered ${status}.`;
}

export function Try({ endpoint }: { endpoint: string }) {
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState(PREFERRED[0]);
  const [key, setKey] = useState("");
  const [prompt, setPrompt] = useState(PROMPT);
  const [run, setRun] = useState<Run>(EMPTY);
  const [tab, setTab] = useState<"curl" | "python" | "ts" | "agents">("curl");
  const stop = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/icm/v1/models", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: Model[] } | null) => {
        const list = (j?.data ?? []).filter((m) => m.id).sort((a, b) => a.id.localeCompare(b.id));
        if (!list.length) return;
        setModels(list);
        const pick = PREFERRED.find((p) => list.some((m) => m.id === p)) ?? list[0].id;
        setModel(pick);
      })
      .catch(() => { /* the select falls back to the preferred list */ });
    return () => stop.current?.abort();
  }, []);

  async function go() {
    if (run.busy) { stop.current?.abort(); return; }
    const ctl = new AbortController();
    stop.current = ctl;
    const started = performance.now();
    let first: number | null = null;
    setRun({ ...EMPTY, busy: true });

    if (MOCK) {
      // No live endpoint behind a mock build: play back a plausible stream so the panel can be seen working.
      const words = "Every purchase destroys the $COMD it is paid with, so the only way supply shrinks is somebody actually using a model. That makes demand for the token a direct reading of demand for inference, not of anyone's guess about the price.".split(" ");
      for (let i = 0; i < words.length; i++) {
        await new Promise((r) => setTimeout(r, i === 0 ? 420 : 38));
        if (ctl.signal.aborted) break;
        first ??= performance.now() - started;
        setRun((r) => ({ ...r, text: r.text + (i ? " " : "") + words[i], firstMs: first }));
      }
      setRun((r) => ({ ...r, busy: false, model, tokensIn: 31, tokensOut: 58, cost: 0.00094, totalMs: Math.round(performance.now() - started) }));
      return;
    }

    try {
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${key.trim()}`, "content-type": "application/json" },
        body: JSON.stringify({ model, stream: true, max_tokens: 700, messages: [{ role: "user", content: prompt }] }),
        signal: ctl.signal,
      });
      if (!res.ok || !res.body) {
        setRun({ ...EMPTY, error: why(res.status, await res.text()) });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let tail = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        tail += dec.decode(value, { stream: true });
        const frames = tail.split("\n\n");
        tail = frames.pop() ?? "";
        for (const frame of frames) {
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const j = JSON.parse(data) as { model?: string; choices?: { delta?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } };
              const piece = j.choices?.[0]?.delta?.content ?? "";
              if (piece) first ??= performance.now() - started;
              setRun((r) => ({
                ...r,
                text: r.text + piece,
                firstMs: first,
                model: j.model ?? r.model,
                tokensIn: j.usage?.prompt_tokens ?? r.tokensIn,
                tokensOut: j.usage?.completion_tokens ?? r.tokensOut,
                cost: typeof j.usage?.cost === "number" ? j.usage.cost : r.cost,
              }));
            } catch { /* a keep-alive or a comment */ }
          }
        }
      }
      setRun((r) => ({ ...r, busy: false, totalMs: Math.round(performance.now() - started) }));
    } catch (e) {
      const err = e as Error;
      setRun((r) => ({ ...r, busy: false, error: err.name === "AbortError" ? (r.text ? null : "Stopped.") : "The endpoint could not be reached from this browser." }));
    }
  }

  const list = models.length ? models.map((m) => m.id) : PREFERRED;
  const snippets = {
    curl: `curl ${endpoint}/chat/completions \\
  -H "Authorization: Bearer $CICM_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [{ "role": "user", "content": "Hello" }]
  }'`,
    python: `import os, requests

r = requests.post(
    "${endpoint}/chat/completions",
    headers={"Authorization": f"Bearer {os.environ['CICM_KEY']}"},
    json={
        "model": "${model}",
        "messages": [{"role": "user", "content": "Hello"}],
    },
)
print(r.json()["choices"][0]["message"]["content"])
print("cost $", r.json()["usage"]["cost"])`,
    ts: `const res = await fetch("${endpoint}/chat/completions", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.CICM_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "${model}",
    messages: [{ role: "user", content: "Hello" }],
  }),
});
const out = await res.json();
console.log(out.choices[0].message.content, out.usage.cost);`,
    agents: `# Any client or agent framework that takes a base URL and a key
base_url: ${endpoint}
api_key:  cicm_live_...    # one key per agent, each with its own ceiling
model:    ${model}

# Switching models is this one line. Same key, same endpoint, same code.`,
  } as const;
  const TABS: [keyof typeof snippets, string][] = [["curl", "cURL"], ["python", "Python"], ["ts", "TypeScript"], ["agents", "Agents"]];

  return (
    <section className="icm-try">
      <div className="icm-cat-say">
        <h2>Try it, then ship it.</h2>
        <p>Run any model from this page with your key, then take the same request into your code.</p>
      </div>

      <div className="try-play">
        <div className="try-form">
          <label className="try-field">
            <span>API key</span>
            <input type="password" autoComplete="off" spellCheck={false} placeholder="cicm_live_…" value={key} onChange={(e) => setKey(e.target.value)} />
            <em>Stays in this tab and goes only to the endpoint. Never stored.</em>
          </label>
          <label className="try-field">
            <span>Model</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {list.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
          <label className="try-field">
            <span>Prompt</span>
            <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <button className={run.busy ? "btn" : "btn primary"} onClick={go} disabled={!run.busy && (!prompt.trim() || (!MOCK && !key.trim()))}>
            {run.busy ? "Stop" : "Run"}
          </button>
        </div>

        <div className="try-out">
          <div className="try-out-head">
            <span className={run.busy ? "dash-dot live-dot" : "dash-dot"} aria-hidden="true" />
            <code>{run.model ?? model}</code>
            {run.busy && <span className="try-state">streaming</span>}
          </div>
          <div className="try-text" aria-live="polite">
            {run.error ? <p className="try-err">{run.error}</p>
              : run.text ? <p>{run.text}{run.busy && <i className="try-caret" aria-hidden="true" />}</p>
              : <p className="muted">{MOCK ? "Press Run to see a sample answer stream in." : "Paste a key and press Run. The answer streams in here, with what it cost."}</p>}
          </div>
          <div className="try-meta">
            <span><b>{run.firstMs !== null ? `${(run.firstMs / 1000).toFixed(2)} s` : "—"}</b>first token</span>
            <span><b>{run.tokensIn ?? "—"} / {run.tokensOut ?? "—"}</b>tokens in / out</span>
            <span><b>{run.totalMs !== null ? `${(run.totalMs / 1000).toFixed(1)} s` : "—"}</b>total</span>
            <span className="try-cost"><b>{run.cost !== null ? `$${run.cost.toFixed(run.cost < 0.01 ? 5 : 4)}` : "—"}</b>this call cost</span>
          </div>
        </div>
      </div>

      <div className="try-code">
        <div className="try-tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>
          ))}
          <span className="try-tabs-gap" />
          <CopyButton text={snippets[tab]} />
        </div>
        <pre className="icm-curl try-pre"><code>{snippets[tab]}</code></pre>
      </div>
    </section>
  );
}
