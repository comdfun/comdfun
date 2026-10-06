/** Wires config, storage, chain, services and the modules into one control plane. */
import { createServer, type Server } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import { erc20Abi, type Abi, type Address } from "viem";
import type { Config } from "./config.ts";
import { createStore, iso, type Store, type KvLike } from "./store.ts";
import { loadBlobStore, type BlobStore } from "./storage.ts";
import { loadServices, type Services } from "./services.ts";
import { MockChain, NoChain, ViemChain, ViemWriter, type ChainReader, type ChainWriter } from "./chain.ts";
import { SkillCatalog, defaultSkillsDir } from "./skills.ts";
import { artModule } from "./art.ts";
import { FlywheelView } from "./flywheel.ts";
import { Engine } from "./engine.ts";
import { Oracle } from "./oracle.ts";
import { Launches, seedPolicies } from "./launches.ts";
import { Workflows } from "./workflows.ts";
import { Scheduler } from "./scheduler.ts";
import { Settlement } from "./settlement.ts";
import { Requests } from "./requests.ts";
import { Pairing } from "./pairing.ts";
import { Device, Fuzz, Sites } from "./device.ts";
import { ChainSettler, MockSettler, type Settler } from "./payments.ts";
import { buildRouter, handler } from "./routes.ts";
import { attachAgentWs } from "./ws.ts";
import type { EventRecord } from "./records.ts";
import type { Router } from "./http.ts";
import { RateLimiter } from "./ratelimit.ts";
import { Keeper, ViemKeeperPort, type KeeperPort } from "./keeper.ts";

export interface AppDeps {
  cfg: Config;
  store?: Store;
  blobs?: BlobStore;
  services?: Services;
  chain?: ChainReader;
  extraChains?: Map<number, ChainReader>;
  writer?: ChainWriter | null;
  settler?: Settler | null;
  now?: () => number;
  fetch?: typeof fetch;
  /** start background loops (default true) */
  timers?: boolean;
  /** keeper chain port (tests); default: ViemKeeperPort when KEEPER_PRIVATE_KEY and RPC_URL are set */
  keeperPort?: KeeperPort | null;
}

export class App {
  readonly cfg: Config;
  readonly store: Store;
  readonly blobs: BlobStore;
  readonly services: Services;
  readonly chain: ChainReader;
  readonly extraChains: Map<number, ChainReader>;
  readonly writer: ChainWriter | null;
  readonly settler: Settler;
  readonly paymentsEnabled: boolean;
  /** decimals of the payment asset (COMD_TOKEN), read on chain at startup; 18 when unreadable */
  comdDecimals = 18;
  readonly skills: SkillCatalog;
  readonly now: () => number;
  readonly fetch: typeof fetch;
  readonly startedAt: number;

  readonly engine: Engine;
  readonly oracle: Oracle;
  readonly launches: Launches;
  readonly workflows: Workflows;
  readonly scheduler: Scheduler;
  readonly settlement: Settlement;
  readonly requests: Requests;
  readonly pairing: Pairing;
  readonly device: Device;
  readonly fuzz: Fuzz;
  readonly sites: Sites;
  readonly flywheel: FlywheelView;
  readonly kv: KvLike;
  keeper!: Keeper;
  readonly limits: { reads: RateLimiter; paid: RateLimiter; quotes: RateLimiter };
  deployBreaker = { open: false, reason: null as string | null, failures: 0, openedAt: null as string | null };

  router!: Router;
  server!: Server;
  private timers: NodeJS.Timeout[] = [];
  private pending = new Set<Promise<unknown>>();
  private listeners = new Set<(e: EventRecord) => void>();

  private constructor(d: Required<Omit<AppDeps, "timers" | "writer" | "settler" | "extraChains" | "keeperPort">> & { writer: ChainWriter | null; settler: Settler; paymentsEnabled: boolean; extraChains: Map<number, ChainReader> }) {
    this.cfg = d.cfg;
    this.store = d.store;
    this.blobs = d.blobs;
    this.services = d.services;
    this.chain = d.chain;
    this.extraChains = d.extraChains;
    this.writer = d.writer;
    this.settler = d.settler;
    this.paymentsEnabled = d.paymentsEnabled;
    this.now = d.now;
    this.fetch = d.fetch;
    this.startedAt = d.now();
    this.skills = new SkillCatalog(d.cfg.skillsDir ?? defaultSkillsDir());
    this.kv = {
      get: (k) => this.store.c<any>("kv").get(k)?.value,
      set: (k, v) => { this.store.c<any>("kv").save({ id: k, createdAt: iso(this.now()), value: v }); },
    };
    this.limits = { reads: new RateLimiter(d.cfg.readsPerMinute, 60_000, d.now), paid: new RateLimiter(d.cfg.requestsPerMinute, 60_000, d.now), quotes: new RateLimiter(d.cfg.quotesPerMinute, 60_000, d.now) };
    this.engine = new Engine(this);
    this.oracle = new Oracle(this);
    this.launches = new Launches(this);
    this.workflows = new Workflows(this);
    this.scheduler = new Scheduler(this);
    this.settlement = new Settlement(this);
    this.requests = new Requests(this);
    this.pairing = new Pairing(this);
    this.device = new Device(this);
    this.fuzz = new Fuzz(this);
    this.sites = new Sites(this);
    this.flywheel = new FlywheelView(this);
  }

  static async create(deps: AppDeps): Promise<App> {
    const cfg = deps.cfg;
    await artModule(); // @company/art dist (logs and reports art_fallback if it cannot load)
    const store = deps.store ?? createStore(cfg.databaseUrl);
    await store.init();
    const blobs = deps.blobs ?? (await loadBlobStore(cfg.storage));
    const services = deps.services ?? (await loadServices({ store: blobs, sitesDomain: cfg.sitesDomain, githubOrg: cfg.githubOrg, attesterKey: cfg.attesterKey, env: cfg.storage, skillsDir: cfg.skillsDir ?? defaultSkillsDir(), projectFactory: cfg.projectFactory, forgeBin: cfg.forgeBin }));
    const addrs = { counselNft: cfg.counselNft, identityRegistry: cfg.identityRegistry, reputationRegistry: cfg.reputationRegistry, rewardDistributor: cfg.rewardDistributor, contributorDistributor: cfg.contributorDistributor, projectFactory: cfg.projectFactory, permit2: cfg.permit2 };
    const chain = deps.chain ?? (cfg.rpcUrl ? new ViemChain(cfg.rpcUrl, cfg.chainId, addrs) : new NoChain(cfg.chainId));
    const extraChains = deps.extraChains ?? new Map<number, ChainReader>();
    if (!deps.extraChains) {
      for (const [k, v] of Object.entries(cfg.storage)) {
        const m = /^RPC_URL_(\d+)$/.exec(k);
        if (m && v && Number(m[1]) !== cfg.chainId) extraChains.set(Number(m[1]), new ViemChain(v, Number(m[1]), { ...addrs, counselNft: null, identityRegistry: null, rewardDistributor: null, projectFactory: null }));
      }
    }
    const writer = deps.writer !== undefined ? deps.writer : cfg.settlerKey && cfg.rpcUrl ? new ViemWriter(cfg.rpcUrl, cfg.chainId, cfg.settlerKey, addrs) : null;
    let settler: Settler;
    let paymentsEnabled = true;
    if (deps.settler) settler = deps.settler;
    else if (writer && cfg.rpcUrl) settler = new ChainSettler(chain, writer, cfg.permit2);
    else {
      const spender: Address = cfg.settlerKey ? privateKeyToAccount(cfg.settlerKey).address : "0x5e771e5e771e5e771e5e771e5e771e5e771e5e77";
      settler = new MockSettler(spender);
      paymentsEnabled = (cfg.storage.PAYMENTS_MODE ?? (cfg.storage.NODE_ENV === "production" ? "off" : "mock")) === "mock";
    }
    const app = new App({ cfg, store, blobs, services, chain, extraChains, writer, settler, paymentsEnabled, now: deps.now ?? Date.now, fetch: deps.fetch ?? fetch });
    // $COMD is Pons's token: read its decimals rather than assume them (18 expected; fallback 18 when unreadable)
    if (chain.configured && !/^0x0{40}$/i.test(cfg.comd)) {
      try {
        const d = Number(await chain.readContract<number | bigint>(cfg.comd, erc20Abi as Abi, "decimals"));
        if (Number.isInteger(d) && d >= 0 && d <= 36) app.comdDecimals = d;
        else console.warn(`[app] COMD_TOKEN ${cfg.comd} decimals() = ${d}; using 18`);
      } catch (e) {
        console.warn(`[app] COMD_TOKEN ${cfg.comd} decimals() unreadable (${(e as Error).message.split("\n")[0].slice(0, 120)}); using 18`);
      }
    }
    const kc = cfg.keeper;
    const port = deps.keeperPort !== undefined ? deps.keeperPort : kc.key && cfg.rpcUrl ? new ViemKeeperPort(cfg.rpcUrl, cfg.chainId, kc.key) : null;
    app.keeper = new Keeper(kc, port, { now: app.now, reason: !kc.key ? "KEEPER_PRIVATE_KEY not set" : !cfg.rpcUrl ? "RPC_URL not set" : null });
    seedPolicies(app);
    app.router = buildRouter(app);
    app.server = createServer(handler(app));
    attachAgentWs(app.server, app);
    if (deps.timers !== false) app.startTimers();
    return app;
  }

  startTimers() {
    const every = (ms: number, fn: () => unknown) => {
      const t = setInterval(() => { try { const r = fn(); if (r instanceof Promise) r.catch((e) => console.error("[timer]", e)); } catch (e) { console.error("[timer]", e); } }, ms);
      t.unref();
      this.timers.push(t);
    };
    every(1_000, () => this.engine.tick());
    every(5_000, () => this.scheduler.tick());
    every(Math.max(2_000, Math.min(60_000, Math.floor((this.cfg.epochSeconds * 1000) / 4))), () => this.settlement.tick());
    if (this.chain.configured) every(600_000, () => this.pairing.refreshOwners(true).catch(() => undefined));
    this.keeper.start();
  }

  listen(port = this.cfg.port, host = this.cfg.host): Promise<number> {
    return new Promise((resolve) => this.server.listen(port, host, () => resolve((this.server.address() as any).port)));
  }

  async close() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.keeper?.stop();
    for (const s of [...this.engine.sessions.values()]) s.close(1001, "server shutting down");
    await new Promise<void>((r) => (this.server.listening ? this.server.close(() => r()) : r()));
    this.server.closeAllConnections?.();
    await this.idle();
    await this.store.close();
  }

  /** Keep track of background work (verification, delivery, attestation) so tests can await it. */
  track<T>(p: Promise<T>): Promise<T> {
    this.pending.add(p);
    p.catch((e) => console.error("[background]", e)).finally(() => this.pending.delete(p));
    return p;
  }

  async idle(rounds = 50) {
    for (let i = 0; i < rounds && this.pending.size; i++) await Promise.allSettled([...this.pending]);
  }

  event(type: string, data: Record<string, unknown>) {
    const col = this.store.c<EventRecord>("events");
    const t = this.now();
    const ev: EventRecord = { id: `${t.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, createdAt: iso(t), type, data };
    col.save(ev);
    if (col.count() > 3000) for (const e of col.newest().slice(2500)) col.delete(e.id);
    for (const l of this.listeners) l(ev);
  }

  onEvent(fn: (e: EventRecord) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  chainFor(chainId: number): ChainReader | null {
    if (chainId === this.cfg.chainId) return this.chain.configured ? this.chain : null;
    return this.extraChains.get(chainId) ?? null;
  }

  rpcChains(): number[] {
    return [...(this.chain.configured ? [this.cfg.chainId] : []), ...this.extraChains.keys()];
  }
}

export { MockChain };
