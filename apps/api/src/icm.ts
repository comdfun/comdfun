/**
 * cICM — Company Inference Capital Markets.
 *
 * Buy AI inference with $COMD. This file is the *only* place Company.md and `@company/icm` meet: it supplies the
 * four things the package deliberately does not have — a config, a store, a way to see payments, and a way to
 * prove who an owner is — and nothing else in the repository imports the package directly.
 *
 * That separation is the point. The same package runs on another chain with another token by writing a second
 * file like this one.
 *
 * How a person uses it:
 *
 *   1. send $COMD to the burn address (`ICM_DEPOSIT_ADDRESS`, `0x…dEaD` by default)
 *   2. the watcher sees the transfer, credits the sending wallet, and — because the payment went to the burn
 *      address — the payment *is* the burn. The firm never holds the token
 *   3. sign a message to prove the wallet is theirs, and mint an API key
 *   4. point any OpenAI-compatible client at `api.comd.fun/icm/v1` with that key
 *
 * The honest part, which `/icm/admin/book` states in money: burning the $COMD means the treasury takes in nothing
 * it can spend, while owing a real dollar bill to the model provider for every credit sold. The book shows the
 * outstanding liability and what it would cost upstream to serve it. That number is meant to be looked at.
 */
import { randomBytes } from "node:crypto";
import { getAddress, pad, verifyMessage, type Address, type Hex } from "viem";
import {
  DepositWatcher, IcmError, Ledger, Proxy, OpenRouterUpstream, createSurface, makeConfig,
  type ConfirmedPayment, type IcmConfig, type IcmRequest, type IcmResponse, type PaymentSource,
  type Row, type Store as IcmStore, type Upstream, type UpstreamModel,
} from "@company/icm";
import type { App } from "./app.ts";
import type { CollectionName, Rec } from "./store.ts";
import { E } from "./errors.ts";

/** Transfer(address indexed from, address indexed to, uint256 value) */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex;
/** Where tokens go to die on an ERC-20 with no burn(), which is what $COMD is. */
export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

/** The package's collection names are a closed set of its own; these are the host's. One mapping, in one place. */
const TABLE: Record<string, CollectionName> = {
  icm_accounts: "icm_accounts",
  icm_keys: "icm_keys",
  icm_deposits: "icm_deposits",
  icm_charges: "icm_charges",
};

/** The package's Store, over the control plane's own collections, so cICM rows persist exactly like everything
 *  else does and `DATABASE_URL` is the only thing that decides durability. */
function storeAdapter(app: App): IcmStore {
  const c = (name: string) => {
    const mapped = TABLE[name];
    if (!mapped) throw new Error(`cICM asked for an unknown collection: ${name}`);
    // The package's records carry `id` and `createdAt`, which is exactly what `Rec` wants.
    return app.store.c<Rec & Record<string, unknown>>(mapped);
  };
  return {
    get: <T extends Row>(n: string, id: string) => c(n).get(id) as T | undefined,
    save: <T extends Row>(n: string, rec: T) => { c(n).save(rec as unknown as Rec & Record<string, unknown>); return rec; },
    all: <T extends Row>(n: string) => c(n).all() as unknown as T[],
    filter: <T extends Row>(n: string, p: (r: T) => boolean) => c(n).filter(p as (r: unknown) => boolean) as unknown as T[],
    find: <T extends Row>(n: string, p: (r: T) => boolean) => c(n).find(p as (r: unknown) => boolean) as unknown as T | undefined,
    count: (n: string, p?: (r: never) => boolean) => (p ? c(n).count(p as (r: unknown) => boolean) : c(n).all().length),
    delete: (n: string, id: string) => c(n).delete(id),
  };
}

/** Reads $COMD transfers into the deposit address straight off the chain. Nothing is trusted from a third party:
 *  the token address, the topic and the destination all come from config and are matched here. */
class ChainPayments implements PaymentSource {
  private readonly app: App;
  private readonly token: Address;
  private readonly to: Address;
  private readonly confirmations: number;
  constructor(app: App, token: Address, to: Address, confirmations: number) {
    this.app = app; this.token = token; this.to = to; this.confirmations = confirmations;
  }

  async since(cursor: string | null): Promise<{ payments: ConfirmedPayment[]; cursor: string }> {
    const head = await this.app.chain.blockNumber();
    // Stay behind the head by the confirmation depth, so a reorg cannot un-credit a payment that was already
    // spent. The cursor only ever moves forward over blocks that are this deep.
    const safe = Math.max(0, head - this.confirmations);
    const from = cursor === null ? Math.max(0, safe - 5_000) : Number(cursor) + 1;
    if (from > safe) return { payments: [], cursor: String(safe) };
    // at most 50k blocks per pass, so a long outage catches up over several rather than one enormous query
    const to = Math.min(safe, from + 50_000);
    // `rawLogs` is optional on the reader interface: a mock chain in tests does not have it, and without it
    // there is nothing to watch rather than something to crash over.
    if (!this.app.chain.rawLogs) return { payments: [], cursor: String(safe) };
    const logs = await this.app.chain.rawLogs(this.token, [TRANSFER_TOPIC, null, pad(this.to, { size: 32 })], from, to);
    const payments = logs.filter((l) => l.topics.length >= 3).map((l): ConfirmedPayment => ({
      // the log index makes two transfers in one transaction two payments
      ref: `${l.txHash}:${l.logIndex}`,
      from: `0x${(l.topics[1] ?? "").slice(26)}`.toLowerCase(),
      to: `0x${(l.topics[2] ?? "").slice(26)}`.toLowerCase(),
      tokenUnits: BigInt(l.data === "0x" ? 0 : l.data),
      at: new Date().toISOString(),
      blockNumber: l.blockNumber,
    }));
    return { payments, cursor: String(to) };
  }
}

/**
 * Stands in for the model provider when no key is configured. Everything that does not need a provider — the rate
 * card, buying credit, minting a key, reading a balance — goes on working, and the one thing that does need one
 * says exactly why rather than the whole surface going dark.
 */
class NoUpstream implements Upstream {
  readonly name = "none";
  private readonly why: string;
  constructor(why: string) { this.why = why; }
  async models(): Promise<UpstreamModel[]> { return []; }
  async complete(): Promise<never> { throw new IcmError(this.why, { code: "not_configured", status: 503 }); }
  async stream(): Promise<never> { throw new IcmError(this.why, { code: "not_configured", status: 503 }); }
}

export interface IcmDeps {
  app: App;
}

export class Icm {
  readonly config: IcmConfig;
  readonly ledger: Ledger;
  readonly proxy: Proxy;
  readonly watcher: DepositWatcher | null;
  readonly enabled: boolean;
  readonly reason: string | null;
  private readonly app: App;
  private readonly surface: (req: IcmRequest) => Promise<IcmResponse>;
  /** One-time nonces for proving a wallet, held in memory: a nonce that does not survive a restart is a nonce
   *  that cannot be replayed after one. */
  private readonly nonces = new Map<string, { nonce: string; at: number }>();

  constructor(d: IcmDeps) {
    this.app = d.app;
    const settings = d.app.cfg.icm;
    const token = d.app.cfg.comd ?? null;
    const depositAddress = settings.depositAddress;

    this.config = makeConfig({
      keyPrefix: "cicm",
      environment: settings.environment,
      token: {
        symbol: "COMD",
        address: token ?? "0x0000000000000000000000000000000000000001",
        decimals: 18,
        chainId: d.app.cfg.chainId,
        // The rate is set by hand and changed by hand. A live feed on a thin pool is a way to sell a dollar of
        // inference for a cent during a wick; the cost of a hand-set rate is drift, which the book shows.
        tokensPerUsd: settings.comdPerUsd,
        sink: depositAddress.toLowerCase() === DEAD_ADDRESS.toLowerCase() ? "burn" : "treasury",
      },
      marginBps: settings.marginBps,
      minDepositMicroUsd: settings.minDepositUsd,
      maxHoldMicroUsd: settings.maxHoldUsd,
      allowModels: settings.allowModels,
      denyModels: settings.denyModels,
    });

    this.ledger = new Ledger({ store: storeAdapter(d.app), config: this.config, now: () => d.app.now() });

    this.enabled = Boolean(settings.openRouterKey);
    this.reason = this.enabled ? null : "OPENROUTER_API_KEY is not set, so cICM can sell and account for credit but cannot route a call yet";
    // The ledger does not need a provider. Credit can be bought, a key minted and a balance read with the
    // gateway half-built, so the surface is always mounted and only the routing refuses.
    this.proxy = new Proxy({
      ledger: this.ledger,
      upstream: settings.openRouterKey
        ? new OpenRouterUpstream({ apiKey: settings.openRouterKey, referer: d.app.cfg.publicWebUrl, title: "Company.md cICM" })
        : new NoUpstream(this.reason!),
      now: () => d.app.now(),
    });
    this.surface = createSurface({ ledger: this.ledger, proxy: this.proxy, adminToken: d.app.cfg.adminToken });

    this.watcher = token && d.app.chain.configured
      ? new DepositWatcher({
          ledger: this.ledger,
          source: new ChainPayments(d.app, getAddress(token), getAddress(depositAddress), settings.confirmations),
          depositAddress,
          cursor: {
            read: () => (d.app.store.c<Rec & { value?: string }>("kv").get("icm:cursor")?.value ?? null),
            write: (value: string) => { d.app.store.c<Rec & { value?: string }>("kv").save({ id: "icm:cursor", createdAt: new Date(d.app.now()).toISOString(), value }); },
          },
          onCredited: (deposit: { creditedMicroUsd: string; accountId: string; ref: string }) => console.log(`[icm] credited ${deposit.creditedMicroUsd} micro-USD to ${deposit.accountId} for ${deposit.ref}`),
          onSkipped: (p: { ref: string }, why: string) => console.warn(`[icm] skipped ${p.ref}: ${why}`),
        })
      : null;
  }

  /** The text a wallet signs to prove it is theirs. It names the service and carries a nonce, so a signature
   *  taken for something else cannot be used here and one taken here cannot be replayed. */
  message(address: string, nonce: string): string {
    return [
      "Company.md — cICM",
      "",
      "Sign in to manage your inference API keys.",
      "This is not a transaction. It moves nothing and costs no gas.",
      "",
      `Wallet: ${address.toLowerCase()}`,
      `Nonce: ${nonce}`,
    ].join("\n");
  }

  nonce(address: string): { nonce: string; message: string } {
    const a = this.addr(address);
    const nonce = randomBytes(16).toString("hex");
    this.nonces.set(a, { nonce, at: this.app.now() });
    return { nonce, message: this.message(a, nonce) };
  }

  /** Verify the signature over this wallet's outstanding nonce. The nonce is spent either way, so a failed
   *  attempt cannot be retried against the same one. */
  async verify(address: string, signature: string): Promise<string> {
    const a = this.addr(address);
    const pending = this.nonces.get(a);
    if (!pending || this.app.now() - pending.at > 5 * 60_000) throw E.invalidRequest("ask for a fresh nonce first (POST /icm/nonce)");
    this.nonces.delete(a);
    let ok = false;
    try { ok = await verifyMessage({ address: getAddress(a), message: this.message(a, pending.nonce), signature: signature as Hex }); } catch { ok = false; }
    if (!ok) throw E.unauthorized("bad_signature", "that signature does not match this wallet");
    return a;
  }

  private addr(address: string): string {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) throw E.invalidId("wallet must be 0x and 40 hex characters");
    return address.toLowerCase();
  }

  /** Where to pay and what it buys. Public: somebody deciding whether to use this needs it before they have a key. */
  instructions() {
    const card = this.watcher?.instructions();
    return {
      enabled: this.enabled,
      reason: this.reason,
      environment: this.config.environment,
      deposit: card ?? { address: null, note: "payment watching is not configured on this deployment" },
      rate: { tokensPerUsd: this.config.token.tokensPerUsd, symbol: this.config.token.symbol, marginBps: this.config.marginBps },
      endpoint: `${this.app.cfg.publicApiUrl}/icm/v1`,
      compatible: "OpenAI chat completions. Point any client at the endpoint with your cICM key as the bearer.",
    };
  }

  /** Mount point for everything the package serves. */
  async handle(req: IcmRequest): Promise<IcmResponse> {
    return this.surface(req);
  }

  /** One pass of the payment watcher, for the keeper to call on a schedule. */
  async poll() {
    if (!this.watcher) return { seen: 0, credited: [], skipped: [], cursor: null };
    return this.watcher.poll();
  }

  /** Holds whose request never reported back. Run on the same schedule as the watcher; a hold nobody resolves is
   *  a customer's money they cannot spend. */
  sweep() {
    return this.ledger.sweepStaleHolds();
  }

  /** For `/health`: enough to see that it is on and that the book balances, and nothing a customer owns. */
  status() {
    const book = this.ledger.book();
    return {
      enabled: this.enabled,
      reason: this.reason,
      watching: this.watcher !== null,
      sink: this.config.token.sink,
      tokensPerUsd: this.config.token.tokensPerUsd,
      marginBps: this.config.marginBps,
      accounts: book.counts.accounts,
      outstandingUsd: book.outstandingMicroUsd,
      coverNeededUsd: book.backing.coverNeededMicroUsd,
      unknownCharges: book.counts.unknown,
      drift: this.ledger.check().length,
    };
  }
}
