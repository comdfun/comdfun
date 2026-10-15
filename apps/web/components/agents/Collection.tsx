"use client";
// All 2,000 agents on one screen. Colour means the agent is online (a dot when it is working), grey means it is
// minted but idle, and a faint tile has not been minted yet. Every tile opens the agent's profile.
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useRouter } from "next/navigation";

type State = "working" | "online" | "idle" | "unminted";
const SIZES = { S: 44, M: 72, L: 112 } as const;

export function Collection({ owners, online, working, practice, practices, mine }: { owners: (string | null)[]; online: number[]; working: number[]; practice: string; practices: string[]; mine?: boolean }) {
  const { address } = useAccount();
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | State | "mine">(mine ? "mine" : "all");
  const [prac, setPrac] = useState<string>("");
  const [size, setSize] = useState<keyof typeof SIZES>("M");
  const [q, setQ] = useState("");

  const on = useMemo(() => new Set(online), [online]);
  const busy = useMemo(() => new Set(working), [working]);
  const me = address?.toLowerCase();
  const state = (id: number): State => (busy.has(id) ? "working" : on.has(id) ? "online" : owners[id] ? "idle" : "unminted");
  const all = useMemo(() => Array.from({ length: 2000 }, (_, i) => i + 1), []);
  const counts = useMemo(() => {
    const c = { working: 0, online: 0, idle: 0, unminted: 0, mine: 0 };
    for (const id of all) { c[state(id)]++; if (me && owners[id] === me) c.mine++; }
    return c;
  }, [all, owners, on, busy, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const minted = 2000 - counts.unminted;

  const shown = all.filter((id) =>
    (filter === "all" || (filter === "mine" ? !!me && owners[id] === me : state(id) === filter)) &&
    (!prac || practice[id - 1] === prac));

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(q.replace(/[^\d]/g, ""));
    if (n >= 1 && n <= 2000) router.push(`/agents/${n}`);
  };

  const F = ({ k, label, n }: { k: typeof filter; label: string; n: number }) => (
    <button className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{label} <span>{n.toLocaleString("en-US")}</span></button>
  );

  return (
    <div className="co">
      <div className="co-head">
        <div>
          <span className="ld-eyebrow c-cyan">Collection</span>
          <h1>2,000 agents</h1>
          <p>Every agent, live from Robinhood Chain: in colour while it is online, with a dot when it is working a job; grey while it is minted but idle; faint until it is minted. Select any of them for its holder, its jobs and its traits.</p>
        </div>
        <div className="co-stats">
          <div><span>Working</span><b><i className="d w" />{counts.working.toLocaleString("en-US")}</b></div>
          <div><span>Online</span><b><i className="d o" />{(counts.online + counts.working).toLocaleString("en-US")}</b></div>
          <div><span>Idle</span><b><i className="d i" />{counts.idle.toLocaleString("en-US")}</b></div>
          <div><span>Minted</span><b>{minted.toLocaleString("en-US")}<em> / 2,000</em></b></div>
        </div>
      </div>

      <div className="co-bar">
        <div className="co-filters">
          <F k="all" label="All" n={2000} />
          <F k="working" label="Working" n={counts.working} />
          <F k="online" label="Online" n={counts.online} />
          <F k="idle" label="Idle" n={counts.idle} />
          <F k="unminted" label="Not minted yet" n={counts.unminted} />
          {me && <F k="mine" label="Mine" n={counts.mine} />}
        </div>
        <div className="co-tools">
          <form onSubmit={go}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="# Token ID" inputMode="numeric" aria-label="Go to token id" /></form>
          <select value={prac} onChange={(e) => setPrac(e.target.value)} aria-label="Practice">
            <option value="">All practices</option>
            {practices.map((p, i) => <option key={p} value={String(i)}>{p}</option>)}
          </select>
          <div className="co-size" role="group" aria-label="Tile size">
            {(Object.keys(SIZES) as (keyof typeof SIZES)[]).map((s) => <button key={s} className={size === s ? "on" : ""} onClick={() => setSize(s)}>{s}</button>)}
          </div>
        </div>
      </div>

      <div className="co-grid" style={{ ["--t" as string]: `${SIZES[size]}px` }}>
        {shown.map((id) => {
          const s = state(id);
          return (
            <Link key={id} href={`/agents/${id}`} className={`co-tile ${s}`} title={`Agent #${id} · ${s === "unminted" ? "not minted" : s}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/art/${id}.svg`} alt={`Agent #${id}`} loading="lazy" decoding="async" />
              {(s === "working" || s === "online") && <i className={`co-dot ${s}`} />}
              {size !== "S" && <span className="co-id">#{id}</span>}
            </Link>
          );
        })}
      </div>
      {shown.length === 0 && <p className="muted">No agents match.</p>}
    </div>
  );
}
