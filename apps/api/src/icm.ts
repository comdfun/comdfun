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
 *   4. point any chat-completions client at `api.comd.fun/icm/v1` with that key, naming any model it routes to
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
/** Where tokens go to die on an ERC-20 with no burn(), which is what $COMD is. The Flywheel's buybacks,
 *  Incorporations' cut and every manual burn all land here, so it is the one address cICM must not watch. */
export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const SHARED_BURN = /^0x0{39}[01]$|^0x0{36}dead$/i;

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
export class ChainPayments implements PaymentSource {
  private readonly app: App;
  private readonly token: Address;
  private readonly to: Address;
  private readonly confirmations: number;
  /** Contracts allowed to pay on somebody else's behalf, lower-cased. See `creditedSender`. */
  private readonly forwarders: Set<string>;
  constructor(app: App, token: Address, to: Address, confirmations: number, forwarders: Address[] = []) {
    this.app = app; this.token = token; this.to = to; this.confirmations = confirmations;
    this.forwarders = new Set(forwarders.map((f) => f.toLowerCase()));
  }

  /**
   * Who to credit for a transfer into the desk.
   *
   * Normally the wallet in the Transfer's `from` is the buyer, and that is the end of it. A swap is the exception:
   * when somebody pays in ETH, the pool moves the $COMD, so the transfer arrives `from` the pool and crediting it
   * literally would put every ETH purchase on one account belonging to nobody. For those, and only those, the
   * wallet that signed the transaction is the buyer.
   *
   * This is deliberately a closed list rather than a rule about contracts in general. Anything may send tokens
   * here; if an unknown contract could nominate its own transaction's signer as the beneficiary, then a contract
   * that batches several people's payments into one transaction would credit all of them to whoever sent it.
   * Only contracts the operator has named are trusted to be paying on one person's behalf.
   */
  private async creditedSender(from: string, txHash: Hex): Promise<string> {
    if (!this.forwarders.has(from.toLowerCase())) return from;
    const signer = this.app.chain.txSender ? await this.app.chain.txSender(txHash) : null;
    // No signer means the RPC would not say. Keeping the forwarder is wrong but inert: it credits an account
    // nobody can sign for, which is recoverable by hand, where guessing a buyer would not be.
    return signer ? signer.toLowerCase() : from;
  }

  async since(cursor: string | null): Promise<{ payments: ConfirmedPayment[]; cursor: string }> {
    const head = await this.app.chain.blockNumber();
    // Stay behind the head by the confirmation depth, so a reorg cannot un-credit a payment that was already
    // spent. The cursor only ever moves forward over blocks that are this deep.
    const safe = Math.max(0, head - this.confirmations);
    const from = cursor === null ? Math.max(0, safe - 2_000) : Number(cursor) + 1;
    if (from > safe) return { payments: [], cursor: String(safe) };
    // At most 2,000 blocks a pass. The RPC is shared with payments, pairing and the burn tracker, and a desk
    // nobody is using yet must not spend the rate limit they need. A long outage catches up over many passes.
    const to = Math.min(safe, from + 2_000);
    // `rawLogs` is optional on the reader interface: a mock chain in tests does not have it, and without it
    // there is nothing to watch rather than something to crash over.
    if (!this.app.chain.rawLogs) return { payments: [], cursor: String(safe) };
    const logs = await this.app.chain.rawLogs(this.token, [TRANSFER_TOPIC, null, pad(this.to, { size: 32 })], from, to);
    const payments: ConfirmedPayment[] = [];
    for (const l of logs) {
      if (l.topics.length < 3) continue;
      const sender = `0x${(l.topics[1] ?? "").slice(26)}`.toLowerCase();
      payments.push({
        // the log index makes two transfers in one transaction two payments
        ref: `${l.txHash}:${l.logIndex}`,
        from: await this.creditedSender(sender, l.txHash),
        to: `0x${(l.topics[2] ?? "").slice(26)}`.toLowerCase(),
        tokenUnits: BigInt(l.data === "0x" ? 0 : l.data),
        at: new Date().toISOString(),
        blockNumber: l.blockNumber,
      });
    }
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
  /** Set when cICM could not be configured at all. Every route then answers 503 with this. */
  readonly fault: string | null;
  /** Why payments are not being watched, or null when they are. Shown on /icm and /health. */
  readonly depositProblem: string | null;
  private readonly app: App;
  private readonly surface: (req: IcmRequest) => Promise<IcmResponse>;
  /** One-time nonces for proving a wallet, held in memory: a nonce that does not survive a restart is a nonce
   *  that cannot be replayed after one. */
  private readonly nonces = new Map<string, { nonce: string; at: number }>();

  constructor(d: IcmDeps) {
    this.app = d.app;
    const settings = d.app.cfg.icm;
    // A malformed address, a rate that will not parse, a token that is not set: every one of those used to
    // throw out of here, and throwing out of here takes the whole control plane down with it. cICM is an
    // optional desk bolted to the side of a firm; it does not get to stop the firm answering. Anything that
    // cannot be configured disables cICM, names itself on /health, and leaves everything else alone.
    const bad = (e: unknown) => `cICM is misconfigured and switched off: ${(e as Error).message}`;
    const safeAddress = (v: string | null): Address | null => { try { return v ? getAddress(v) : null; } catch { return null; } };
    const token = safeAddress(d.app.cfg.comd ?? null);
    // The shared burn address is where the Flywheel, Incorporations and every manual burn already send $COMD.
    // Watching it would read every buyback as a payment for inference and fill the house book with credit
    // nobody bought. cICM needs an address nothing else pays into, so this refuses the trap outright.
    // Why payments are not being watched, in words, carried all the way to the page. Refusing an address and
    // then reporting "not configured" is a lie that costs somebody an afternoon looking for a variable they
    // already set.
    const set = settings.depositAddress;
    this.depositProblem =
      !set ? "ICM_DEPOSIT_ADDRESS is not set, so there is nowhere to send $COMD yet."
      : SHARED_BURN.test(set) ? `ICM_DEPOSIT_ADDRESS is the shared burn address. Everything already burns there — the Flywheel's buybacks, Incorporations' cut, every manual burn — so cICM cannot tell a payment for inference from any of them. Use an address nothing else pays into, and set ICM_BURN_ON_DEPOSIT=1 to burn what lands in it.`
      : !/^0x[0-9a-fA-F]{40}$/.test(set) ? `ICM_DEPOSIT_ADDRESS is not an address: it must be 0x and 40 hex characters. Got ${JSON.stringify(set.slice(0, 48))}.`
      : !d.app.cfg.comd ? "COMD_TOKEN is not set, so there is no token to watch for."
      : !d.app.chain.configured ? "No RPC is configured, so the chain cannot be watched for payments."
      : null;
    const depositAddress = this.depositProblem ? null : set;

    let config: IcmConfig | null = null;
    let fault: string | null = null;
    try {
      config = makeConfig({
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
        // A dedicated deposit address holds the $COMD until it is burned, so the payment is not the burn and the
        // book must not claim one. ICM_BURN_ON_DEPOSIT=1 says the operator burns every deposit on a schedule.
        sink: settings.burnOnDeposit ? "burn" : "treasury",
      },
      marginBps: settings.marginBps,
      minDepositMicroUsd: settings.minDepositUsd,
      maxHoldMicroUsd: settings.maxHoldUsd,
        allowModels: settings.allowModels,
        denyModels: settings.denyModels,
      });
    } catch (e) {
      fault = bad(e);
      console.error(`[icm] ${fault}`);
      // A shape the rest of the class can hold without branching. Nothing is served from it: `fault` is set,
      // so every route answers 503 with the reason.
      config = makeConfig({ keyPrefix: "cicm", token: { symbol: "OFF", address: "0x0000000000000000000000000000000000000001", tokensPerUsd: "1" } });
    }
    this.config = config;
    this.fault = fault;

    this.ledger = new Ledger({ store: storeAdapter(d.app), config: this.config, now: () => d.app.now() });

    this.enabled = !fault && Boolean(settings.openRouterKey);
    this.reason = fault
      ?? (this.enabled ? null : "OPENROUTER_API_KEY is not set, so cICM can sell and account for credit but cannot route a call yet");
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

    this.watcher = this.buildWatcher(d, token, fault ? null : depositAddress);
  }

  /** Never throws. A deposit address that will not parse switches watching off and says so, rather than
   *  stopping the process at boot. */
  private buildWatcher(d: IcmDeps, token: Address | null, depositAddress: string | null): DepositWatcher | null {
    if (!token || !depositAddress || !d.app.chain.configured) return null;
    try {
      return this.makeWatcher(d, token, depositAddress);
    } catch (e) {
      console.error(`[icm] payment watching is off: ${(e as Error).message}`);
      return null;
    }
  }

  /** Contracts allowed to pay into the desk for somebody else: the buyback swapper, which is what a "pay in ETH"
   *  purchase routes through, plus anything else named in ICM_FORWARDERS. Anything unparseable is dropped with a
   *  line in the log rather than taking payment watching down with it. */
  private forwarders(d: IcmDeps): Address[] {
    const named = [d.app.cfg.swapper, ...d.app.cfg.icm.forwarders];
    const out: Address[] = [];
    for (const a of named) {
      if (!a) continue;
      try { out.push(getAddress(a)); }
      catch { console.warn(`[icm] ignoring forwarder that is not an address: ${JSON.stringify(String(a).slice(0, 48))}`); }
    }
    return out;
  }

  private makeWatcher(d: IcmDeps, token: Address, depositAddress: string): DepositWatcher {
    const settings = d.app.cfg.icm;
    return token && depositAddress && d.app.chain.configured
      ? new DepositWatcher({
          ledger: this.ledger,
          source: new ChainPayments(d.app, token, getAddress(depositAddress), settings.confirmations, this.forwarders(d)),
          depositAddress,
          cursor: {
            read: () => (d.app.store.c<Rec & { value?: string }>("kv").get("icm:cursor")?.value ?? null),
            write: (value: string) => { d.app.store.c<Rec & { value?: string }>("kv").save({ id: "icm:cursor", createdAt: new Date(d.app.now()).toISOString(), value }); },
          },
          onCredited: (deposit: { creditedMicroUsd: string; accountId: string; ref: string }) => console.log(`[icm] credited ${deposit.creditedMicroUsd} micro-USD to ${deposit.accountId} for ${deposit.ref}`),
          onSkipped: (p: { ref: string }, why: string) => console.warn(`[icm] skipped ${p.ref}: ${why}`),
        })
      : (() => { throw new Error("not configured"); })();
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
      deposit: card ?? { address: null, problem: this.depositProblem, note: this.depositProblem ?? "Payments are not being watched on this deployment." },
      rate: { tokensPerUsd: this.config.token.tokensPerUsd, symbol: this.config.token.symbol, marginBps: this.config.marginBps },
      endpoint: `${this.app.cfg.publicApiUrl}/icm/v1`,
      compatible: "Standard chat completions. Point any client at the endpoint with your cICM key as the bearer, and name the model you want in the request.",
    };
  }

  /** Mount point for everything the package serves. A faulted deployment answers 503 everywhere rather than
   *  serving a ledger built on a configuration nobody meant. */
  async handle(req: IcmRequest): Promise<IcmResponse> {
    if (this.fault) return { status: 503, headers: { "content-type": "application/json; charset=utf-8" }, json: { error: { message: this.fault, code: "not_configured", type: "not_configured" } } };
    return this.surface(req);
  }

  /** One pass of the payment watcher, for the keeper to call on a schedule. */
  async poll() {
    if (this.fault || !this.watcher) return { seen: 0, credited: [], skipped: [], cursor: null };
    return this.watcher.poll();
  }

  /** Holds whose request never reported back. Run on the same schedule as the watcher; a hold nobody resolves is
   *  a customer's money they cannot spend. */
  sweep() {
    return this.ledger.sweepStaleHolds();
  }

  /** For `/health`: enough to see that it is on and that the book balances, and nothing a customer owns. */
  status() {
    if (this.fault) return { enabled: false, reason: this.fault, watching: false, fault: true };
    const book = this.ledger.book();
    return {
      enabled: this.enabled,
      reason: this.reason,
      watching: this.watcher !== null,
      depositProblem: this.depositProblem,
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
