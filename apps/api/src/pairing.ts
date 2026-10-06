/**
 * Pairing a device to a Counsel seat, enrollments, and ERC-8004 agent registration.
 *
 *   POST /pair/start {deviceKey}                  → code + nonce (10 minutes)
 *   GET  /pair?code=…                             → HTML page: connect wallet, sign WorkerAuthorization
 *   POST /pair/complete {code, message, signature} → EIP-712 recover + on-chain ownerOf(tokenId) == wallet
 *   GET  /agents/register-intent?tokenId=         → calldata for IdentityRegistry.register(agentURI)
 *   POST /agents/bind {tokenId, agentId}          → checks the registry: owner and agentURI
 * One active device per seat; an unregistered seat cannot connect.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { encodeFunctionData, getAddress, type Address } from "viem";
import { DEVICE_KEY_RE, recoverTypedSigner, workerAuthorizationTypedData, typedDataJson, type WorkerAuthorizationMessage } from "@company/protocol";
import type { App } from "./app.ts";
import { ApiError, E } from "./errors.ts";
import type { EnrollmentRecord, PairingRecord, SeatRecord } from "./records.ts";
import { iso } from "./store.ts";
import { ChainUnavailable } from "./chain.ts";
import { counselMetadata } from "./art.ts";
import { identityRegistryAbi } from "@company/abi";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PAIRING_TTL_S = 600;

export class Pairing {
  private readonly app: App;
  owners: { at: number; owners: (string | null)[] } = { at: 0, owners: [] };
  private refreshing: Promise<void> | null = null;
  constructor(app: App) { this.app = app; }

  private get pairings() { return this.app.store.c<PairingRecord>("pairings"); }
  private get enrollments() { return this.app.store.c<EnrollmentRecord>("enrollments"); }
  get seats() { return this.app.store.c<SeatRecord>("seats"); }

  relayOrigin(): string {
    return new URL(this.app.cfg.publicApiUrl).origin;
  }

  seat(tokenId: string): SeatRecord {
    let s = this.seats.get(tokenId);
    if (!s) {
      const now = iso(this.app.now());
      s = { id: tokenId, createdAt: now, updatedAt: now, tokenId, agentId: null, owner: null, ownerCheckedAt: 0, deviceKey: null, wallet: null, lastSeenAt: null, connectedAt: null, version: null, runtime: null, sitesToday: { day: "", count: 0 } };
      this.seats.save(s);
    }
    return s;
  }

  start(body: any) {
    const deviceKey = body?.deviceKey;
    if (typeof deviceKey !== "string" || !DEVICE_KEY_RE.test(deviceKey)) throw E.invalidRequest("deviceKey must be 64 lowercase hex (the Ed25519 public key)");
    let code = "";
    do {
      const b = randomBytes(8);
      code = Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
      code = `${code.slice(0, 4)}-${code.slice(4)}`;
    } while (this.pairings.has(code));
    const now = this.app.now();
    const p: PairingRecord = { id: code, createdAt: iso(now), updatedAt: iso(now), code, deviceKey, nonce: `0x${randomBytes(32).toString("hex")}`, expiresAt: Math.floor(now / 1000) + PAIRING_TTL_S, relayOrigin: this.relayOrigin(), consumed: false, wallet: null, tokenId: null };
    this.pairings.save(p);
    const template: WorkerAuthorizationMessage = { deviceKey: `0x${deviceKey}`, wallet: "0x0000000000000000000000000000000000000000", tokenId: "0", nonce: p.nonce, expiresAt: p.expiresAt, relayOrigin: p.relayOrigin };
    return {
      code, nonce: p.nonce, expiresAt: p.expiresAt, relayOrigin: p.relayOrigin, chainId: this.app.cfg.chainId, nftContract: this.app.cfg.counselNft,
      // the website's /pair page (wallet connect, ERC-8004 registration, signing); Chambers' own GET /pair page is the fallback
      pairUrl: `${this.app.cfg.publicWebUrl}/pair?code=${code}`,
      apiPairUrl: `${this.app.cfg.publicApiUrl}/pair?code=${code}`,
      typedData: typedDataJson(workerAuthorizationTypedData(template, this.app.cfg.chainId)),
    };
  }

  get(code: string) {
    const p = this.pairings.get(code.toUpperCase());
    if (!p) throw E.notFound("unknown pairing code");
    const enr = p.consumed ? this.enrollments.get(p.deviceKey) : undefined;
    return {
      code: p.code, deviceKey: p.deviceKey, nonce: p.nonce, relayOrigin: p.relayOrigin, chainId: this.app.cfg.chainId, nftContract: this.app.cfg.counselNft,
      expiresAt: p.expiresAt, expired: !p.consumed && Math.floor(this.app.now() / 1000) > p.expiresAt,
      consumed: p.consumed, enrolled: enr?.status === "active", wallet: p.wallet, tokenId: p.tokenId, agentId: p.tokenId ? this.seat(p.tokenId).agentId : null,
    };
  }

  async complete(body: any) {
    const code = String(body?.code ?? "").toUpperCase();
    const p = this.pairings.get(code);
    if (!p) throw E.notFound("unknown pairing code");
    if (p.consumed) throw E.conflict("code_consumed", "this pairing code was already used");
    const nowS = Math.floor(this.app.now() / 1000);
    if (nowS > p.expiresAt) throw new ApiError(410, "pairing_expired", "the pairing code expired; run `company pair` again");
    const raw = body?.message as WorkerAuthorizationMessage;
    if (!raw || typeof raw !== "object") throw E.invalidRequest("message is required");
    // bytes32 fields arrive with or without 0x (the web app strips it); the signature covers the bytes either way
    const hex32 = (v: unknown) => (typeof v === "string" && /^(0x)?[0-9a-fA-F]{64}$/.test(v) ? (`0x${v.replace(/^0x/, "").toLowerCase()}` as `0x${string}`) : v);
    const m = { ...raw, deviceKey: hex32(raw.deviceKey), nonce: hex32(raw.nonce), expiresAt: typeof raw.expiresAt === "string" && /^[0-9]+$/.test(raw.expiresAt) ? Number(raw.expiresAt) : raw.expiresAt } as WorkerAuthorizationMessage;
    if (String(m.deviceKey).toLowerCase() !== `0x${p.deviceKey}`) throw E.invalidRequest("message.deviceKey does not match the pairing");
    if (String(m.nonce).toLowerCase() !== p.nonce) throw E.invalidRequest("message.nonce does not match the pairing");
    if (m.relayOrigin !== p.relayOrigin) throw E.invalidRequest(`message.relayOrigin must be ${p.relayOrigin}`);
    if (!Number.isInteger(m.expiresAt) || m.expiresAt < nowS) throw E.invalidRequest("message.expiresAt is in the past");
    if (typeof m.wallet !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(m.wallet)) throw E.invalidRequest("message.wallet must be an address");
    if (typeof m.tokenId !== "string" && typeof m.tokenId !== "number") throw E.invalidRequest("message.tokenId is required");
    const tokenId = String(m.tokenId);
    if (!/^[0-9]{1,10}$/.test(tokenId)) throw E.invalidRequest("message.tokenId must be a decimal token id");
    const td = workerAuthorizationTypedData({ ...m, tokenId }, this.app.cfg.chainId);
    const signer = await recoverTypedSigner(td, String(body?.signature ?? ""));
    if (!signer || signer.toLowerCase() !== m.wallet.toLowerCase()) throw E.unauthorized("invalid_signature", "WorkerAuthorization is not signed by message.wallet");
    let owner: Address | null;
    try { owner = await this.app.chain.ownerOf(tokenId); } catch (e) { throw E.unavailable("ownership_unavailable", `could not read ownerOf(${tokenId}): ${(e as Error).message}`); }
    if (!owner) throw E.invalidRequest(`token ${tokenId} does not exist`);
    if (owner.toLowerCase() !== m.wallet.toLowerCase()) throw E.forbidden("not_owner", `wallet does not hold Counsel #${tokenId}`);

    const wallet = getAddress(m.wallet).toLowerCase() as Address;
    for (const e of this.enrollments.filter((x) => x.tokenId === tokenId && x.status === "active" && x.deviceKey !== p.deviceKey)) {
      if (e.wallet === wallet) throw E.conflict("token_enrolled", `Counsel #${tokenId} already has an active device; run \`company unlink\` there first`);
      this.revoke(e, "ownership changed");
    }
    const prev = this.enrollments.get(p.deviceKey);
    if (prev && prev.status === "active" && prev.tokenId !== tokenId) this.revoke(prev, "device re-paired to another seat");
    const now = iso(this.app.now());
    const enr: EnrollmentRecord = { id: p.deviceKey, createdAt: prev?.createdAt ?? now, updatedAt: now, deviceKey: p.deviceKey, tokenId, wallet, status: "active", reason: null, authorization: { ...m, tokenId }, signature: String(body.signature), revokedAt: null };
    this.enrollments.save(enr);
    p.consumed = true;
    p.wallet = wallet;
    p.tokenId = tokenId;
    p.updatedAt = now;
    this.pairings.save(p);
    const seat = this.seat(tokenId);
    Object.assign(seat, { owner: wallet, ownerCheckedAt: this.app.now(), deviceKey: p.deviceKey, wallet, updatedAt: now });
    this.seats.save(seat);
    this.app.event("seat.paired", { tokenId, deviceKey: p.deviceKey, wallet });
    return {
      enrolled: true, deviceKey: p.deviceKey, tokenId, wallet, agentId: seat.agentId, registered: !!seat.agentId,
      registerIntent: seat.agentId ? null : `${this.app.cfg.publicApiUrl}/agents/register-intent?tokenId=${tokenId}`,
    };
  }

  revoke(e: EnrollmentRecord, reason: string) {
    e.status = "revoked";
    e.reason = reason;
    e.revokedAt = iso(this.app.now());
    e.updatedAt = e.revokedAt;
    this.enrollments.save(e);
    const s = this.app.engine.sessions.get(e.deviceKey);
    if (s) {
      s.send({ type: "disconnect", code: 4003, reason: `enrollment revoked: ${reason}` });
      s.close(4003, "enrollment revoked");
      this.app.engine.removeSession(s);
    }
    this.app.event("seat.revoked", { tokenId: e.tokenId, deviceKey: e.deviceKey, reason });
  }

  enrollment(deviceKey: string) {
    if (!DEVICE_KEY_RE.test(deviceKey)) throw E.invalidId("deviceKey must be 64 lowercase hex");
    const e = this.enrollments.get(deviceKey);
    if (!e) return { deviceKey, status: "unknown", reason: "unknown device" };
    return { deviceKey, status: e.status, reason: e.reason, tokenId: e.tokenId, wallet: e.wallet, agentId: this.seat(e.tokenId).agentId, enrolledAt: e.createdAt, revokedAt: e.revokedAt };
  }

  activeEnrollment(deviceKey: string): EnrollmentRecord | null {
    const e = this.enrollments.get(deviceKey);
    return e && e.status === "active" ? e : null;
  }

  activeCount(): number {
    return this.enrollments.count((e) => e.status === "active");
  }

  /** Cached ownerOf with a 60 s TTL (re-read on connect). */
  async ownerOf(tokenId: string, maxAgeMs = 60_000): Promise<Address | null> {
    const s = this.seat(tokenId);
    if (s.owner && this.app.now() - s.ownerCheckedAt < maxAgeMs) return s.owner;
    const o = await this.app.chain.ownerOf(tokenId);
    s.owner = o ? (o.toLowerCase() as Address) : null;
    s.ownerCheckedAt = this.app.now();
    this.seats.save(s);
    return s.owner;
  }

  // ------------------------------------------------------------------------------------------ owners / wallets

  /** Owners of every minted Counsel. Stale-while-revalidate: once a snapshot exists, callers get it at once and a
   *  refresh runs in the background (at most every 30s); `force` waits for a fresh one. A failed lookup keeps the
   *  last known owner instead of blanking it, so a flaky RPC never makes a Counsel look unowned. */
  async refreshOwners(force = false): Promise<void> {
    const have = this.owners.at > 0;
    if (!force && this.app.now() - this.owners.at < 30_000) return;
    if (this.refreshing) return have && !force ? undefined : this.refreshing;
    const run = (async () => {
      try {
        const supply = await this.app.chain.nftTotalSupply();
        const n = Math.min(this.app.cfg.maxSupply, supply);
        const prev = this.owners.owners;
        const ids = Array.from({ length: n }, (_, k) => String(k + 1));
        const got = this.app.chain.ownersOf
          ? await this.app.chain.ownersOf(ids)
          : await Promise.all(ids.map(async (id) => { try { return await this.app.chain.ownerOf(id); } catch (e) { if (e instanceof ChainUnavailable) throw e; return undefined; } }));
        const out: (string | null)[] = new Array(n + 1).fill(null);
        for (let k = 0; k < n; k++) {
          const o = got[k];
          out[k + 1] = o === undefined ? prev[k + 1] ?? null : o?.toLowerCase() ?? null;
        }
        this.owners = { at: this.app.now(), owners: out };
      } finally {
        this.refreshing = null;
      }
    })();
    this.refreshing = run;
    if (have && !force) { run.catch((e) => console.warn(`[pairing] owners refresh failed: ${(e as Error).message}`)); return; }
    return run;
  }

  async wallet(address: string, fresh: boolean) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw E.invalidId("address must be 0x + 40 hex");
    const a = address.toLowerCase();
    try { await this.refreshOwners(fresh); } catch (e) { if (!this.owners.at) throw E.unavailable("chain_unavailable", (e as Error).message); }
    const held = this.owners.owners.map((o, id) => (o === a ? String(id) : null)).filter((x): x is string => x !== null);
    for (const s of this.seats.filter((x) => x.owner === a)) if (!held.includes(s.tokenId)) held.push(s.tokenId);
    return {
      wallet: a,
      refreshedAt: this.owners.at ? iso(this.owners.at) : null,
      seats: held.sort((x, y) => Number(x) - Number(y)).map((tokenId) => {
        const e = this.enrollments.find((x) => x.tokenId === tokenId && x.status === "active");
        const seat = this.seats.get(tokenId);
        const devices = this.enrollments.filter((x) => x.tokenId === tokenId).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 5)
          .map((x) => ({ deviceKey: x.deviceKey, status: x.status, online: !!this.app.engine.sessions.get(x.deviceKey), enrolledAt: x.createdAt, revokedAt: x.revokedAt }));
        return { tokenId, agentId: seat?.agentId ?? null, registered: !!seat?.agentId, enrolled: !!e, deviceKey: e?.deviceKey ?? null, online: !!this.app.engine.sessionForToken(tokenId), devices };
      }),
    };
  }

  // ------------------------------------------------------------------------------------------ agents (ERC-8004)

  agentURI(tokenId: string): string {
    return `${this.app.cfg.publicApiUrl}/agents/by-token/${tokenId}.json`;
  }

  registerIntent(tokenIdQ: string | null) {
    if (!tokenIdQ || !/^[0-9]{1,10}$/.test(tokenIdQ)) throw E.invalidQuery("tokenId is required");
    const reg = this.app.cfg.identityRegistry;
    if (!reg) throw E.unavailable("registry_unavailable", "IDENTITY_REGISTRY is not configured");
    const agentURI = this.agentURI(tokenIdQ);
    // vendored CC0 IdentityRegistry is overloaded; this is register(string agentURI) (selector 0xf2c298be).
    // It mints the agent to msg.sender; agent ids start at 0; the receipt's Registered(agentId, agentURI, owner) names it.
    const data = encodeFunctionData({ abi: identityRegistryAbi, functionName: "register", args: [agentURI] });
    return { to: reg, data, value: "0", chainId: this.app.cfg.chainId, agentURI, function: "register(string agentURI)", selector: data.slice(0, 10), event: "Registered(uint256 indexed agentId, string agentURI, address indexed owner)", then: "POST /agents/bind {tokenId, agentId}" };
  }

  async bind(body: any) {
    const tokenId = String(body?.tokenId ?? "");
    const agentId = String(body?.agentId ?? "");
    if (!/^[0-9]{1,10}$/.test(tokenId) || !/^[0-9]{1,30}$/.test(agentId)) throw E.invalidRequest("tokenId and agentId are decimal ids");
    let agent: { owner: Address; uri: string } | null;
    let owner: Address | null;
    try {
      agent = await this.app.chain.agent(agentId);
      owner = await this.app.chain.ownerOf(tokenId);
    } catch (e) {
      throw E.unavailable("chain_unavailable", (e as Error).message);
    }
    if (!agent) return { status: 202, body: { tokenId, agentId, pending: true, detail: "agent not found yet; retry after the register transaction is mined" } };
    if (agent.uri !== this.agentURI(tokenId)) throw new ApiError(400, "uri_mismatch", `agentURI must be ${this.agentURI(tokenId)}`);
    if (!owner || agent.owner.toLowerCase() !== owner.toLowerCase()) throw E.forbidden("not_owner", "the agent's owner does not hold this Counsel");
    const seat = this.seat(tokenId);
    seat.agentId = agentId;
    seat.owner = owner.toLowerCase() as Address;
    seat.updatedAt = iso(this.app.now());
    this.seats.save(seat);
    this.app.event("seat.registered", { tokenId, agentId });
    return { status: 200, body: { tokenId, agentId, bound: true, agentURI: agent.uri } };
  }

  /** ERC-8004 registration-v1 document (+ OpenSea attributes) from @company/art metadata(), with this deployment's addresses. */
  async registration(tokenId: number) {
    const seat = this.seats.get(String(tokenId));
    const cfg = this.app.cfg;
    const enrolled = this.enrollments.find((e) => e.tokenId === String(tokenId) && e.status === "active");
    const doc = await counselMetadata(tokenId, {
      apiUrl: cfg.publicApiUrl, webUrl: cfg.publicWebUrl, chainId: cfg.chainId, tokenContract: cfg.counselNft?.toLowerCase() ?? "",
      agentId: seat?.agentId != null ? Number(seat.agentId) : null, agentRegistry: cfg.identityRegistry ? `eip155:${cfg.chainId}:${cfg.identityRegistry.toLowerCase()}` : null,
    });
    // ERC-8004 registration fields that depend on live state: `active` = a device is paired to this Counsel (it is at
    // the bar, or will be as soon as its machine is on); `x402Support` = its work is retained through the firm's x402
    // endpoints (quote → 402 → pay in $COMD), so the agent is reachable for paid work.
    const docServices = (doc as unknown as { services?: unknown }).services;
    const base = Array.isArray(docServices) ? (docServices as { name: string; endpoint: string }[]) : [];
    const services = [...base, { name: "x402", endpoint: `${cfg.publicApiUrl}/requests/quote` }, { name: "agent", endpoint: `${cfg.publicApiUrl}/agents/${tokenId}` }];
    return { ...doc, services, active: !!enrolled, x402Support: true, enrolled: !!seat?.agentId, paired: !!enrolled, online: !!this.app.engine.sessionForToken(String(tokenId)) };
  }

  newId() { return randomUUID(); }
}
