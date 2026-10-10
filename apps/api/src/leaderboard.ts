/**
 * The leaderboard: who is actually doing the work.
 *
 * Two tables. Seats, ranked by accepted work, with the $COMD they have been awarded in posted epochs and their
 * acceptance rate. Holders, the same thing summed over every seat a wallet holds, so running several Counsel shows.
 *
 * Everything here is derived from records the firm already keeps — attempts for the work, posted reward epochs for
 * the money, the seats table for the holder. Nothing is stored for the leaderboard's own sake, so it cannot drift
 * from the docket: if a row claims accepted work, that work has filings behind it.
 *
 * "This week" is the trailing seven days, which is also the reward epoch length, so the weekly table and a payout
 * cover the same stretch of time.
 */
import type { App } from "./app.ts";
import type { Attempt, RewardEpoch, SeatRecord } from "./records.ts";

/** Attempts carry the store's id/createdAt once saved. */
type A = Attempt & { id: string; createdAt: string };

const WEEK_MS = 7 * 24 * 3600_000;

export interface SeatRow {
  tokenId: number;
  agentId: string | null;
  owner: string | null;
  accepted: number;
  attempts: number;
  rate: number | null;
  comd: string;
  online: boolean;
  lastAcceptedAt: string | null;
}
export interface HolderRow {
  owner: string;
  seats: number;
  working: number;
  accepted: number;
  comd: string;
}

export class Leaderboard {
  private readonly app: App;
  constructor(app: App) { this.app = app; }

  /** $COMD awarded per seat across every epoch whose root is actually on chain. Queued epochs are not earnings. */
  private awarded(): Map<string, bigint> {
    const by = new Map<string, bigint>();
    for (const e of this.app.store.c<RewardEpoch>("epochs").all()) {
      for (const a of e.assets ?? []) {
        if (a.status !== "posted") continue;
        if (this.app.cfg.comd && a.asset.toLowerCase() !== this.app.cfg.comd.toLowerCase()) continue;
        for (const row of a.entries ?? []) by.set(row.tokenId, (by.get(row.tokenId) ?? 0n) + BigInt(row.amount || "0"));
      }
    }
    return by;
  }

  /** `since` null means all time. */
  seats(since: number | null, limit = 25): SeatRow[] {
    const comd = this.awarded();
    const seats = this.app.store.c<SeatRecord>("seats");
    const rows = new Map<string, SeatRow>();
    const row = (tokenId: string): SeatRow => {
      let r = rows.get(tokenId);
      if (!r) {
        const s = seats.get(tokenId);
        r = {
          tokenId: Number(tokenId), agentId: s?.agentId ?? null, owner: s?.owner ?? null,
          accepted: 0, attempts: 0, rate: null,
          comd: (since === null ? comd.get(tokenId) ?? 0n : 0n).toString(),
          online: !!this.app.engine.sessionForToken(tokenId), lastAcceptedAt: null,
        };
        rows.set(tokenId, r);
      }
      return r;
    };

    for (const a of this.app.store.c<A>("attempts").all()) {
      const at = a.finishedAt ?? a.leasedAt;
      if (since !== null && (!at || Date.parse(at) < since)) continue;
      const r = row(a.tokenId);
      r.attempts += 1;
      if (a.state === "accepted") {
        r.accepted += 1;
        if (!r.lastAcceptedAt || (a.finishedAt ?? "") > r.lastAcceptedAt) r.lastAcceptedAt = a.finishedAt ?? null;
      }
    }

    for (const r of rows.values()) r.rate = r.attempts > 0 ? Math.round((r.accepted / r.attempts) * 100) : null;
    // Accepted work first; a tie goes to the seat that needed fewer attempts to get there, then to the lower id.
    return [...rows.values()]
      .filter((r) => r.attempts > 0)
      .sort((a, b) => b.accepted - a.accepted || a.attempts - b.attempts || a.tokenId - b.tokenId)
      .slice(0, limit);
  }

  holders(since: number | null, limit = 25): HolderRow[] {
    const by = new Map<string, HolderRow>();
    for (const s of this.seats(since, 10_000)) {
      if (!s.owner) continue;
      const key = s.owner.toLowerCase();
      const h = by.get(key) ?? { owner: key, seats: 0, working: 0, accepted: 0, comd: "0" };
      h.seats += 1;
      if (s.online) h.working += 1;
      h.accepted += s.accepted;
      h.comd = (BigInt(h.comd) + BigInt(s.comd)).toString();
      by.set(key, h);
    }
    return [...by.values()]
      .sort((a, b) => b.accepted - a.accepted || b.working - a.working || a.owner.localeCompare(b.owner))
      .slice(0, limit);
  }

  /** The whole board, plus the one number that makes the point: how many seats are idle. */
  view(limit = 25) {
    const week = this.app.now() - WEEK_MS;
    const total = this.app.store.c<SeatRecord>("seats").count();
    const everWorked = this.seats(null, 10_000).length;
    return {
      at: new Date(this.app.now()).toISOString(),
      window: { week: new Date(week).toISOString(), epochDays: 7 },
      seats: { allTime: this.seats(null, limit), week: this.seats(week, limit) },
      holders: { allTime: this.holders(null, limit), week: this.holders(week, limit) },
      counts: { registered: total, everWorked, online: this.app.engine.sessions.size, idle: Math.max(0, total - everWorked) },
    };
  }
}
