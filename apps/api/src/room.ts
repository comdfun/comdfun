/**
 * The Holders Room — a room for people who hold.
 *
 * Entry is a wallet that holds a Counsel or any $COMD, proved by a signature over a one-time nonce (connecting a
 * wallet proves nothing; signing does). The holding is read from the chain at sign-in and again whenever a session is
 * refreshed, so selling out of the room eventually closes the door.
 *
 * Two things happen inside: holders talk, and holders submit promotion they have done elsewhere (a thesis, a post).
 * Submissions are reviewed by an admin wallet. An accepted one accrues a fixed amount of $COMD to its author, and the
 * room keeps a payout ledger the owner settles in batches — nothing here can move funds on its own, and no key for
 * paying lives on this server.
 *
 * Moderation: an admin can remove a wallet, which deletes its messages and its pending submissions and blocks it from
 * signing in again. Accepted submissions already owed are kept, so removing a wallet cannot erase a debt to it.
 *
 * Env: ROOM_ADMINS (comma-separated addresses that may review and remove), PROMO_REWARD_COMD (whole $COMD per
 * accepted submission, default 100).
 */
import { randomUUID, randomBytes } from "node:crypto";
import { encodeFunctionData, getAddress, parseAbi, verifyMessage, type Address, type Hex } from "viem";
import type { App } from "./app.ts";
import { E } from "./errors.ts";
import { iso, type Rec } from "./store.ts";

const erc721 = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

export const ROOM_LIMITS = {
  text: 500,
  note: 280,
  url: 400,
  messagesPerMinute: 10,
  promosPerDay: 5,
  nonceTtlMs: 5 * 60_000,
  sessionTtlMs: 7 * 24 * 3600_000,
} as const;

export const PROMO_KINDS = ["thesis", "post", "video", "article", "other"] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];

export interface RoomSession extends Rec { address: Address; token: string; expiresAt: string }
export interface RoomMessage extends Rec { address: Address; text: string }
export interface RoomPromo extends Rec {
  address: Address; url: string; kind: PromoKind; note: string;
  status: "pending" | "accepted" | "rejected";
  reviewedAt?: string; reviewer?: Address; reason?: string;
  rewardComd?: string; paidAt?: string; payoutTx?: string;
}
export interface RoomBan extends Rec { address: Address; by: Address; reason: string }

export interface Standing { address: Address; counsel: number; comd: string; mayEnter: boolean; admin: boolean }

const lower = (a: string) => a.toLowerCase() as Address;

export class Room {
  private readonly app: App;
  private readonly nonces = new Map<string, { nonce: string; at: number }>();
  constructor(app: App) { this.app = app; }

  private get sessions() { return this.app.store.c<RoomSession>("room_sessions"); }
  private get messages() { return this.app.store.c<RoomMessage>("room_messages"); }
  private get promos() { return this.app.store.c<RoomPromo>("room_promos"); }
  private get bans() { return this.app.store.c<RoomBan>("room_bans"); }

  /** Whole $COMD accrued by one accepted submission. */
  get reward(): bigint {
    const raw = Number(this.app.cfg.storage.PROMO_REWARD_COMD);
    return BigInt(Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 100);
  }

  private admins(): Set<string> {
    const raw = String(this.app.cfg.storage.ROOM_ADMINS ?? "");
    return new Set(raw.split(/[\s,]+/).map((a) => a.trim().toLowerCase()).filter((a) => /^0x[0-9a-f]{40}$/.test(a)));
  }
  isAdmin(address: string): boolean { return this.admins().has(address.toLowerCase()); }
  banned(address: string): boolean { return this.bans.has(address.toLowerCase()); }

  // ---------------------------------------------------------------------------------------- sign in

  /** The text a wallet signs. It names the room and carries a nonce, so a signature cannot be replayed elsewhere. */
  message(address: Address, nonce: string): string {
    return [
      "Company.md — Holders Room",
      "",
      "Sign in to the room. This proves the wallet is yours.",
      "It is not a transaction and costs nothing.",
      "",
      `Wallet: ${getAddress(address)}`,
      `Nonce: ${nonce}`,
    ].join("\n");
  }

  nonce(address: string): { nonce: string; message: string } {
    const a = this.addr(address);
    const nonce = randomBytes(16).toString("hex");
    this.nonces.set(a, { nonce, at: this.app.now() });
    return { nonce, message: this.message(a, nonce) };
  }

  private addr(a: unknown): Address {
    if (typeof a !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(a)) throw E.invalidRequest("address must be a 0x-prefixed 20-byte address");
    return lower(a);
  }

  /** What the chain says about a wallet right now. */
  async standing(address: string): Promise<Standing> {
    const a = this.addr(address);
    let counsel = 0;
    let comd = 0n;
    if (this.app.chain.configured) {
      if (this.app.cfg.counselNft) {
        try {
          const hex = await this.app.chain.call(this.app.cfg.counselNft as Address, encodeFunctionData({ abi: erc721, functionName: "balanceOf", args: [getAddress(a)] }));
          counsel = Number(BigInt(hex || "0x0"));
        } catch { counsel = 0; }
      }
      if (this.app.cfg.comd) {
        try { comd = await this.app.chain.erc20Balance(this.app.cfg.comd as Address, getAddress(a)); } catch { comd = 0n; }
      }
    }
    return { address: a, counsel, comd: comd.toString(), mayEnter: counsel > 0 || comd > 0n, admin: this.isAdmin(a) };
  }

  /** Verify the signature over this wallet's outstanding nonce, check the holding, open a session. */
  async signIn(address: string, signature: string): Promise<{ token: string; expiresAt: string; standing: Standing }> {
    const a = this.addr(address);
    if (this.banned(a)) throw E.forbidden("removed", "this wallet has been removed from the room");
    const pending = this.nonces.get(a);
    if (!pending || this.app.now() - pending.at > ROOM_LIMITS.nonceTtlMs) throw E.invalidRequest("ask for a fresh nonce first (POST /room/nonce)");
    if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) throw E.invalidRequest("signature must be 0x-prefixed hex");
    let ok = false;
    try { ok = await verifyMessage({ address: getAddress(a), message: this.message(a, pending.nonce), signature: signature as Hex }); } catch { ok = false; }
    if (!ok) throw E.unauthorized("bad_signature", "that signature does not recover to this wallet");
    this.nonces.delete(a);

    const standing = await this.standing(a);
    if (!standing.mayEnter) throw E.forbidden("not_a_holder", "the room is for wallets holding a Counsel or any $COMD");

    const token = randomBytes(24).toString("hex");
    const expiresAt = iso(this.app.now() + ROOM_LIMITS.sessionTtlMs);
    this.sessions.save({ id: randomUUID(), createdAt: iso(this.app.now()), address: a, token, expiresAt });
    return { token, expiresAt, standing };
  }

  /** The wallet behind a session token, or null. */
  session(token: string | null | undefined): Address | null {
    if (!token) return null;
    const s = this.sessions.find((x) => x.token === token);
    if (!s) return null;
    if (Date.parse(s.expiresAt) < this.app.now()) return null;
    if (this.banned(s.address)) return null;
    return s.address;
  }

  private require(token: string | null | undefined): Address {
    const a = this.session(token);
    if (!a) throw E.unauthorized("sign_in_required", "sign in to the room first (POST /room/session)");
    return a;
  }

  /** For routes that are admin-only but do not go through one of the methods below. */
  assertAdmin(token: string | null | undefined): Address { return this.requireAdmin(token); }

  private requireAdmin(token: string | null | undefined): Address {
    const a = this.require(token);
    if (!this.isAdmin(a)) throw E.forbidden("admin_required", "only an admin wallet may do that");
    return a;
  }

  // ---------------------------------------------------------------------------------------- chat

  list(limit = 100): { id: string; at: string; address: Address; text: string; admin: boolean }[] {
    const rows = this.messages.all().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return rows.slice(Math.max(0, rows.length - Math.min(limit, 300))).map((m) => ({ id: m.id, at: m.createdAt, address: m.address, text: m.text, admin: this.isAdmin(m.address) }));
  }

  say(token: string | null | undefined, text: unknown): RoomMessage {
    const address = this.require(token);
    if (typeof text !== "string" || !text.trim()) throw E.invalidRequest("say something");
    const body = text.trim().slice(0, ROOM_LIMITS.text);
    const minuteAgo = this.app.now() - 60_000;
    const recent = this.messages.count((m) => m.address === address && Date.parse(m.createdAt) > minuteAgo);
    if (recent >= ROOM_LIMITS.messagesPerMinute) throw E.invalidRequest(`slow down — ${ROOM_LIMITS.messagesPerMinute} messages a minute`);
    return this.messages.save({ id: randomUUID(), createdAt: iso(this.app.now()), address, text: body });
  }

  /** The author may delete their own message; an admin may delete any. */
  unsay(token: string | null | undefined, id: string): void {
    const address = this.require(token);
    const m = this.messages.get(id);
    if (!m) throw E.notFound("no such message");
    if (m.address !== address && !this.isAdmin(address)) throw E.forbidden("not_yours", "that is not your message");
    this.messages.delete(id);
  }

  // ---------------------------------------------------------------------------------------- promotion

  submit(token: string | null | undefined, body: Record<string, unknown>): RoomPromo {
    const address = this.require(token);
    const url = String(body.url ?? "").trim();
    if (!/^https:\/\/[^\s]+$/i.test(url) || url.length > ROOM_LIMITS.url) throw E.invalidRequest("url must be an https link to the thing you posted");
    const kind = String(body.kind ?? "post") as PromoKind;
    if (!PROMO_KINDS.includes(kind)) throw E.invalidRequest(`kind must be one of ${PROMO_KINDS.join(", ")}`);
    const note = String(body.note ?? "").trim().slice(0, ROOM_LIMITS.note);
    if (this.promos.find((p) => p.url.toLowerCase() === url.toLowerCase())) throw E.invalidRequest("that link has already been submitted");
    const dayAgo = this.app.now() - 24 * 3600_000;
    if (this.promos.count((p) => p.address === address && Date.parse(p.createdAt) > dayAgo) >= ROOM_LIMITS.promosPerDay) {
      throw E.invalidRequest(`${ROOM_LIMITS.promosPerDay} submissions a day is the limit`);
    }
    return this.promos.save({ id: randomUUID(), createdAt: iso(this.app.now()), address, url, kind, note, status: "pending" });
  }

  /** Everyone sees accepted submissions and their own; an admin sees everything. */
  promoList(viewer: Address | null): RoomPromo[] {
    const admin = viewer ? this.isAdmin(viewer) : false;
    return this.promos.all()
      .filter((p) => admin || p.status === "accepted" || (viewer && p.address === viewer))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  review(token: string | null | undefined, id: string, decision: unknown, reason: unknown): RoomPromo {
    const reviewer = this.requireAdmin(token);
    const p = this.promos.get(id);
    if (!p) throw E.notFound("no such submission");
    if (p.status !== "pending") throw E.invalidRequest(`already ${p.status}`);
    if (decision !== "accept" && decision !== "reject") throw E.invalidRequest("decision must be accept or reject");
    const next: RoomPromo = {
      ...p,
      status: decision === "accept" ? "accepted" : "rejected",
      reviewedAt: iso(this.app.now()),
      reviewer,
      reason: String(reason ?? "").trim().slice(0, ROOM_LIMITS.note) || undefined,
      ...(decision === "accept" ? { rewardComd: this.reward.toString() } : {}),
      updatedAt: iso(this.app.now()),
    };
    return this.promos.save(next);
  }

  // ---------------------------------------------------------------------------------------- moderation

  /** Remove a wallet: its messages and pending submissions go, and it cannot sign in again. Anything already
   *  accepted and unpaid is kept — removing someone must not be a way to avoid owing them. */
  remove(token: string | null | undefined, address: string, reason: unknown): { messages: number; pending: number } {
    const by = this.requireAdmin(token);
    const a = this.addr(address);
    if (this.isAdmin(a)) throw E.invalidRequest("an admin wallet cannot be removed from the room");
    let messages = 0;
    for (const m of this.messages.filter((x) => x.address === a)) { this.messages.delete(m.id); messages += 1; }
    let pending = 0;
    for (const p of this.promos.filter((x) => x.address === a && x.status === "pending")) { this.promos.delete(p.id); pending += 1; }
    for (const s of this.sessions.filter((x) => x.address === a)) this.sessions.delete(s.id);
    if (!this.bans.has(a)) this.bans.save({ id: a, createdAt: iso(this.app.now()), address: a, by, reason: String(reason ?? "").slice(0, ROOM_LIMITS.note) });
    return { messages, pending };
  }

  readmit(token: string | null | undefined, address: string): void {
    this.requireAdmin(token);
    const a = this.addr(address);
    if (this.bans.has(a)) this.bans.delete(a);
  }

  // ---------------------------------------------------------------------------------------- the ledger

  /** What is owed, per wallet, from accepted submissions that have not been marked paid. */
  owed(): { address: Address; accepted: number; comd: string; oldest: string }[] {
    const by = new Map<Address, { n: number; comd: bigint; oldest: string }>();
    for (const p of this.promos.all()) {
      if (p.status !== "accepted" || p.paidAt) continue;
      const cur = by.get(p.address) ?? { n: 0, comd: 0n, oldest: p.createdAt };
      cur.n += 1;
      cur.comd += BigInt(p.rewardComd ?? this.reward.toString());
      if (p.createdAt < cur.oldest) cur.oldest = p.createdAt;
      by.set(p.address, cur);
    }
    return [...by.entries()]
      .map(([address, v]) => ({ address, accepted: v.n, comd: v.comd.toString(), oldest: v.oldest }))
      .sort((a, b) => a.oldest.localeCompare(b.oldest));
  }

  /** The owner has paid a wallet: close out everything accepted and unpaid for it. */
  markPaid(token: string | null | undefined, address: string, txHash: unknown): { settled: number; comd: string } {
    this.requireAdmin(token);
    const a = this.addr(address);
    const tx = String(txHash ?? "").trim();
    if (tx && !/^0x[0-9a-fA-F]{64}$/.test(tx)) throw E.invalidRequest("txHash must be a 32-byte hash, or left out");
    let settled = 0;
    let comd = 0n;
    for (const p of this.promos.filter((x) => x.address === a && x.status === "accepted" && !x.paidAt)) {
      comd += BigInt(p.rewardComd ?? this.reward.toString());
      settled += 1;
      this.promos.save({ ...p, paidAt: iso(this.app.now()), payoutTx: tx || undefined, updatedAt: iso(this.app.now()) });
    }
    return { settled, comd: comd.toString() };
  }

  /** Numbers for the room's header; safe for anyone to see. */
  stats() {
    const promos = this.promos.all();
    return {
      messages: this.messages.count(),
      members: new Set(this.sessions.all().map((s) => s.address)).size,
      submissions: { pending: promos.filter((p) => p.status === "pending").length, accepted: promos.filter((p) => p.status === "accepted").length },
      rewardComd: this.reward.toString(),
      owedComd: this.owed().reduce((s, r) => s + BigInt(r.comd), 0n).toString(),
    };
  }
}
