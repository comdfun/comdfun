/**
 * FeeTracker — the ETH the firm's fee wallet(s) receive (Pons pays the 5% creator tax there) and what they spend.
 *
 * Native ETH payouts leave no logs, so this needs an indexer. Sources, tried in order, first one that answers wins:
 *   1. Alchemy Transfers API (`alchemy_getAssetTransfers`) on the primary RPC when it is an Alchemy endpoint,
 *   2. Etherscan v2 (`api.etherscan.io/v2`, chainid 4663) when ETHERSCAN_API_KEY is set,
 *   3. Blockscout v2 (`robinhoodchain.blockscout.com/api/v2`) — no key, but may sit behind a bot wall.
 * Aggregates only; the wallet addresses are never part of any response.
 *
 * Env: FEE_WALLETS (comma-separated; defaults to BURN_WALLETS — the Creator wallet is both), FEE_FROM_BLOCK,
 * FEE_CACHE_SECONDS (120). Incremental after the first full scan.
 */
import { getAddress, type Address } from "viem";
import type { App } from "./app.ts";

type Transfer = { key: string; block: number; from: string; to: string; wei: bigint; at: string | null; internal: boolean };
export type FeeSummary = {
  tracked: boolean;
  reason?: string;
  wallets: number;
  source: "alchemy" | "etherscan" | "blockscout" | null;
  received: string; // wei: all ETH that reached the wallets (fee payouts + deposits)
  receivedInternal: string; // wei: of which paid by contracts (fee payouts proper)
  spent: string; // wei: value the wallets sent out (buybacks etc.), gas excluded
  balance: string | null; // wei: current ETH balance (RPC)
  payouts: number;
  lastReceivedAt: string | null;
  scannedToBlock: number | null;
  error?: string;
};

const BLOCKSCOUT = "https://robinhoodchain.blockscout.com/api/v2";

export class FeeTracker {
  private readonly app: App;
  private received = 0n;
  private receivedInternal = 0n;
  private spent = 0n;
  private payouts = 0;
  private lastReceivedAt: string | null = null;
  private scannedTo: number | null = null;
  private source: FeeSummary["source"] = null;
  private seen = new Set<string>();
  private last = 0;
  private refreshing: Promise<void> | null = null;
  private error: string | null = null;
  private balance: bigint | null = null;
  constructor(app: App) { this.app = app; }

  get wallets(): Address[] {
    const spec = this.app.cfg.storage.FEE_WALLETS || this.app.cfg.storage.BURN_WALLETS || "";
    return spec.split(/[\s,]+/).filter((x) => /^0x[0-9a-fA-F]{40}$/.test(x)).map((x) => getAddress(x));
  }
  private get alchemyUrl(): string | null {
    const first = (this.app.cfg.rpcUrl ?? "").split(/[\s,]+/).find(Boolean) ?? "";
    return /alchemy\.com/.test(first) ? first : null;
  }
  private get etherscanKey() { return this.app.cfg.storage.ETHERSCAN_API_KEY || null; }
  private get ttlMs() { return Math.max(30, Number(this.app.cfg.storage.FEE_CACHE_SECONDS ?? 120)) * 1000; }

  async summary(): Promise<FeeSummary> {
    const wallets = this.wallets;
    const tracked = wallets.length > 0;
    if (tracked) {
      if (this.app.now() - this.last > this.ttlMs && !this.refreshing) this.refreshing = this.refresh().finally(() => { this.refreshing = null; });
      if (this.scannedTo === null && this.refreshing) await this.refreshing.catch(() => undefined);
    }
    return {
      tracked,
      ...(tracked ? {} : { reason: "FEE_WALLETS / BURN_WALLETS not set" }),
      wallets: wallets.length,
      source: this.source,
      received: this.received.toString(),
      receivedInternal: this.receivedInternal.toString(),
      spent: this.spent.toString(),
      balance: this.balance?.toString() ?? null,
      payouts: this.payouts,
      lastReceivedAt: this.lastReceivedAt,
      scannedToBlock: this.scannedTo,
      ...(this.error ? { error: this.error } : {}),
    };
  }

  // ---------------------------------------------------------------------------------------- sources
  private async alchemy(wallet: Address, fromBlock: number): Promise<Transfer[]> {
    const url = this.alchemyUrl!;
    const out: Transfer[] = [];
    for (const dir of ["toAddress", "fromAddress"] as const) {
      let pageKey: string | undefined;
      for (let page = 0; page < 20; page++) {
        const params: Record<string, unknown> = { fromBlock: `0x${fromBlock.toString(16)}`, toBlock: "latest", [dir]: wallet, category: ["external", "internal"], withMetadata: true, excludeZeroValue: true, maxCount: "0x3e8", order: "asc" };
        if (pageKey) params.pageKey = pageKey;
        const r = await this.app.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "alchemy_getAssetTransfers", params: [params] }), signal: AbortSignal.timeout(20_000) });
        const j = (await r.json()) as { result?: { transfers: { hash: string; blockNum: string; from: string; to: string; value: number | null; category: string; metadata?: { blockTimestamp?: string }; uniqueId?: string }[]; pageKey?: string }; error?: { message: string } };
        if (j.error) throw new Error(`alchemy: ${j.error.message}`);
        for (const t of j.result?.transfers ?? []) {
          const wei = BigInt(Math.round((t.value ?? 0) * 1e6)) * 10n ** 12n; // value is ETH as a decimal; 6 decimals is plenty for a fee
          out.push({ key: `a:${t.uniqueId ?? `${t.hash}:${t.category}:${t.to}:${t.value}`}`, block: parseInt(t.blockNum, 16), from: t.from, to: t.to ?? "", wei, at: t.metadata?.blockTimestamp ?? null, internal: t.category === "internal" });
        }
        pageKey = j.result?.pageKey;
        if (!pageKey) break;
      }
    }
    return out;
  }

  private async etherscan(wallet: Address, fromBlock: number): Promise<Transfer[]> {
    const out: Transfer[] = [];
    for (const action of ["txlistinternal", "txlist"] as const) {
      const u = new URL("https://api.etherscan.io/v2/api");
      u.search = new URLSearchParams({ chainid: String(this.app.cfg.chainId), module: "account", action, address: wallet, startblock: String(fromBlock), endblock: "99999999", page: "1", offset: "10000", sort: "asc", apikey: this.etherscanKey! }).toString();
      const r = await this.app.fetch(u.toString(), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`etherscan ${action}: HTTP ${r.status}`);
      const j = (await r.json()) as { status: string; message: string; result: unknown };
      if (!Array.isArray(j.result)) { if (/no transactions/i.test(`${j.message} ${j.result}`)) continue; throw new Error(`etherscan ${action}: ${j.message} ${String(j.result).slice(0, 100)}`); }
      for (const t of j.result as { hash: string; blockNumber: string; timeStamp: string; from: string; to: string; value: string; isError?: string; traceId?: string }[]) {
        if (t.isError === "1") continue;
        out.push({ key: `e:${t.hash}:${t.traceId ?? ""}:${t.to}:${t.value}`, block: Number(t.blockNumber), from: t.from, to: t.to ?? "", wei: BigInt(t.value || "0"), at: new Date(Number(t.timeStamp) * 1000).toISOString(), internal: action === "txlistinternal" });
      }
    }
    return out;
  }

  private async blockscout(wallet: Address, fromBlock: number): Promise<Transfer[]> {
    const out: Transfer[] = [];
    for (const kind of ["internal-transactions", "transactions"] as const) {
      let next: Record<string, unknown> | null = null;
      for (let page = 0; page < 30; page++) {
        const u = new URL(`${BLOCKSCOUT}/addresses/${wallet}/${kind}`);
        if (next) for (const [k, v] of Object.entries(next)) u.searchParams.set(k, String(v));
        const r = await this.app.fetch(u.toString(), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
        if (!r.ok) throw new Error(`blockscout ${kind}: HTTP ${r.status}`);
        const j = (await r.json()) as { items: { transaction_hash?: string; hash?: string; block_number?: number; block?: number; timestamp?: string; from?: { hash: string }; to?: { hash: string } | null; value: string; index?: number; success?: boolean; result?: string }[]; next_page_params: Record<string, unknown> | null };
        let stop = false;
        for (const t of j.items ?? []) {
          const block = Number(t.block_number ?? t.block ?? 0);
          if (block < fromBlock) { stop = true; continue; }
          if (t.success === false || (t.result && t.result !== "ok" && t.result !== "success")) continue;
          const hash = t.transaction_hash ?? t.hash ?? "";
          out.push({ key: `b:${hash}:${t.index ?? ""}:${t.to?.hash ?? ""}:${t.value}`, block, from: t.from?.hash ?? "", to: t.to?.hash ?? "", wei: BigInt(t.value || "0"), at: t.timestamp ?? null, internal: kind === "internal-transactions" });
        }
        next = j.next_page_params;
        if (!next || stop) break;
      }
    }
    return out;
  }

  private async refresh(): Promise<void> {
    try {
      const from = this.scannedTo === null ? Math.max(0, Number(this.app.cfg.storage.FEE_FROM_BLOCK) || 0) : this.scannedTo + 1;
      const mine = new Set(this.wallets.map((w) => w.toLowerCase()));
      let maxBlock = this.scannedTo ?? 0;
      const errors: string[] = [];
      for (const w of this.wallets) {
        const me = w.toLowerCase();
        let transfers: Transfer[] | null = null;
        const attempts: [FeeSummary["source"], (() => Promise<Transfer[]>) | null][] = [
          ["alchemy", this.alchemyUrl ? () => this.alchemy(w, from) : null],
          ["etherscan", this.etherscanKey ? () => this.etherscan(w, from) : null],
          ["blockscout", () => this.blockscout(w, from)],
        ];
        for (const [name, fn] of attempts) {
          if (!fn) continue;
          try { transfers = await fn(); this.source = name; break; } catch (e) { errors.push((e as Error).message.split("\n")[0].slice(0, 120)); }
        }
        if (!transfers) throw new Error(errors.join(" · ") || "no transfer source available");
        for (const t of transfers) {
          if (this.seen.has(t.key)) continue;
          this.seen.add(t.key);
          const to = t.to.toLowerCase(), fr = t.from.toLowerCase();
          if (to === me && !mine.has(fr) && t.wei > 0n) {
            this.received += t.wei; this.payouts++;
            if (t.internal) this.receivedInternal += t.wei;
            if (t.at && (!this.lastReceivedAt || t.at > this.lastReceivedAt)) this.lastReceivedAt = t.at;
          } else if (fr === me && !mine.has(to) && t.wei > 0n && !t.internal) {
            this.spent += t.wei;
          }
          maxBlock = Math.max(maxBlock, t.block);
        }
      }
      // never re-scan below what we have seen; if the sources returned nothing, keep the old cursor
      if (maxBlock > (this.scannedTo ?? 0)) this.scannedTo = maxBlock; else if (this.scannedTo === null) this.scannedTo = 0;
      if (this.app.chain.configured) {
        let b = 0n;
        for (const w of this.wallets) b += await this.app.chain.ethBalance(w);
        this.balance = b;
      }
      this.error = null;
    } catch (e) {
      this.error = (e as Error).message.split("\n")[0].slice(0, 240);
    } finally {
      this.last = this.app.now();
    }
  }
}
