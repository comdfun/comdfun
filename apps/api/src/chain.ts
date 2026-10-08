/**
 * Chain access with the generated ABIs of `@company/abi` (contracts/out → packages/abi).
 *
 * `ChainReader` covers every read the control plane needs (seat ownership, ERC-8004 registration, oracle
 * reproduction recipes, reward/launch state); `ChainWriter` the settler's transactions:
 *   - Permit2.permitWitnessTransferFrom (x402 exact/permit2 settlement, the server is the spender and pays gas)
 *   - ReputationRegistry.giveFeedback(agentId, int128 value, uint8 valueDecimals, tag1, tag2, endpoint,
 *     feedbackURI, feedbackHash) (vendored CC0 ERC-8004 v2; never from an agent's owner: "Self-feedback not allowed")
 *   - RewardDistributor.postRoot(epoch, asset, root, total): one root per (epoch, asset), `total` must be covered by
 *     `unallocated(asset)`; leaf keccak256(bytes.concat(keccak256(abi.encode(epoch, tokenId, amount))))
 * Launch contributor roots are NOT posted by the settler: ProjectFactory.launch(params) registers
 * `params.contributorRoot` with the ContributorDistributor in the launch transaction itself (launchId =
 * launchCount() + 1 at that moment), so the Registrar builds the root before it deploys.
 *
 * `ViemChain`/`ViemWriter` talk to RPC_URL (the writer serialises its transactions: one key, one nonce stream);
 * `MockChain`/`MockWriter` back tests and demos.
 */
import {
  createPublicClient, createWalletClient, decodeAbiParameters, decodeEventLog, encodeFunctionData, erc20Abi, fallback, getAddress, http, keccak256, parseAbi, toHex, zeroAddress,
  type Abi, type Address, type Hex, type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { counselNFTAbi, identityRegistryAbi, projectFactoryAbi, reputationRegistryAbi, rewardDistributorAbi } from "@company/abi";
import { WITNESS_TYPE_STRING, witnessHash, type Permit2Authorization } from "@company/protocol";

export interface BlockInfo { number: number; hash: Hex; timestamp: number }

/** ProjectFactory `Launched` event, decoded from a launch transaction's receipt. */
export interface LaunchedEvent {
  launchId: number;
  kind: number;
  token: Address;
  paired: Address;
  poolId: Hex;
  poolAmount: string;
  contributorAmount: string;
  remainderAmount: string;
  remainderTo: Address;
  txHash: Hex;
  blockNumber: number;
}

export interface ChainReader {
  readonly configured: boolean;
  readonly chainId: number;
  blockNumber(): Promise<number>;
  block(n: number | "latest"): Promise<BlockInfo>;
  /** Counsel NFT owner; null when the token does not exist. */
  ownerOf(tokenId: string): Promise<Address | null>;
  /** Owners of many Counsel at once (Multicall3 when the chain has it, else parallel ownerOf); `undefined` = lookup failed. */
  ownersOf?(tokenIds: string[]): Promise<(Address | null | undefined)[]>;
  nftTotalSupply(): Promise<number>;
  /** ERC-8004 IdentityRegistry owner + URI of an agent; null when unknown. */
  agent(agentId: string): Promise<{ owner: Address; uri: string } | null>;
  call(to: Address, data: Hex, blockNumber?: number): Promise<Hex>;
  logCount(address: Address, topics: (Hex | null)[], fromBlock: number, toBlock: number): Promise<number>;
  balance(address: Address, blockNumber?: number): Promise<bigint>;
  getCode(address: Address): Promise<Hex>;
  erc20Balance(token: Address, owner: Address): Promise<bigint>;
  erc20TotalSupply(token: Address): Promise<bigint>;
  /** Raw logs for an address + topic filter (chunked); optional — the BurnTracker is off without it. */
  rawLogs?(address: Address, topics: (Hex | null)[], fromBlock: number, toBlock: number): Promise<RawLog[]>;
  erc20Allowance(token: Address, owner: Address, spender: Address): Promise<bigint>;
  ethBalance(address: Address): Promise<bigint>;
  /** RewardDistributor.unallocated(asset): balance not committed to posted roots. */
  rewardUnallocated(asset: Address): Promise<bigint>;
  /** RewardDistributor.roots(epoch, asset).root != 0 */
  rewardRootPosted(epoch: number, asset: Address): Promise<boolean>;
  /** ProjectFactory.launchCount() (the next launch gets launchCount + 1). */
  factoryLaunchCount(): Promise<number>;
  /** Decode ProjectFactory.Launched from a transaction receipt; null when the tx did not launch. */
  launchedEvent(txHash: Hex): Promise<LaunchedEvent | null>;
  /** Generic view call (website stats such as GET /flywheel). */
  readContract<T = unknown>(address: Address, abi: Abi, functionName: string, args?: readonly unknown[]): Promise<T>;
  /** Decoded logs of `address` in [fromBlock, toBlock] (chunked). */
  events(address: Address, abi: Abi, fromBlock: number, toBlock: number): Promise<ChainEvent[]>;
}

export interface ChainEvent { eventName: string; args: Record<string, unknown>; blockNumber: number; txHash: Hex; logIndex: number }
export type RawLog = { topics: Hex[]; data: Hex; blockNumber: number; txHash: Hex; logIndex: number };

export interface SettleArgs { auth: Permit2Authorization; signature: Hex; payTo: Address; amount: bigint }
export interface TxResult { txHash: Hex; blockNumber: number; status: "success" | "reverted"; gasUsed: string }

export interface ChainWriter {
  readonly address: Address;
  permit2Settle(a: SettleArgs): Promise<{ txHash: Hex; blockNumber: number; status: "success" | "reverted" }>;
  giveFeedback(args: { agentId: bigint; value: bigint; valueDecimals?: number; tag1: string; tag2: string; endpoint: string; feedbackURI: string; feedbackHash: Hex }): Promise<{ txHash: Hex; blockNumber: number; gasUsed: string }>;
  /** RewardDistributor.postRoot(epoch, asset, root, total) — SETTLER_ROLE. */
  postRoot(epoch: bigint, asset: Address, root: Hex, total: bigint): Promise<TxResult>;
}

export interface ChainAddresses {
  counselNft: Address | null;
  identityRegistry: Address | null;
  reputationRegistry: Address | null;
  rewardDistributor: Address | null;
  contributorDistributor: Address | null;
  projectFactory: Address | null;
  permit2: Address;
}

/** Permit2 is an external contract (Uniswap); only the two functions the settler uses. */
export const permit2Abi = parseAbi([
  "struct TokenPermissions { address token; uint256 amount; }",
  "struct PermitTransferFrom { TokenPermissions permitted; uint256 nonce; uint256 deadline; }",
  "struct SignatureTransferDetails { address to; uint256 requestedAmount; }",
  "function permitWitnessTransferFrom(PermitTransferFrom permit, SignatureTransferDetails transferDetails, address owner, bytes32 witness, string witnessTypeString, bytes signature)",
  "function nonceBitmap(address owner, uint256 wordPos) view returns (uint256)",
  "error InvalidNonce()",
  "error SignatureExpired(uint256 signatureDeadline)",
  "error InvalidSigner()",
  "error InvalidSignature()",
  "error InvalidSignatureLength()",
  "error InvalidAmount(uint256 maxAmount)",
]);

/** The ABIs this module uses, re-exported for callers that encode calldata (register-intent, tests). */
export const ABIS = { counselNFT: counselNFTAbi, identityRegistry: identityRegistryAbi, reputationRegistry: reputationRegistryAbi, rewardDistributor: rewardDistributorAbi, projectFactory: projectFactoryAbi, permit2: permit2Abi, erc20: erc20Abi } as const;

/** `RPC_URL` may list several endpoints (comma/space/newline separated): the first is primary, the rest take over
 *  when it fails or is blocked (a public RPC behind a bot challenge returns 403 to servers). Order is kept (no ranking),
 *  so the paid/dedicated endpoint should come first. */
export function rpcUrls(spec: string): string[] {
  const list = spec.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean);
  return list.length ? list : [spec];
}
export function rpcTransport(spec: string, opts: { timeout?: number; retryCount?: number } = {}) {
  const urls = rpcUrls(spec);
  // a 429 from a metered endpoint is retried briefly before the next endpoint is tried; a 403 (bot wall) is not retried
  const transports = urls.map((u) => http(u, { timeout: opts.timeout ?? 10_000, retryCount: Math.max(opts.retryCount ?? 1, 2), retryDelay: 250 }));
  return transports.length === 1 ? transports[0] : fallback(transports, { rank: false, retryCount: 0 });
}

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const ownerOfAbi = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);
const notFound = (e: unknown) => /nonexistent|ERC721NonexistentToken|invalid token|reverted|revert/i.test((e as Error).message);

export class ViemChain implements ChainReader {
  readonly configured = true;
  readonly chainId: number;
  readonly client: PublicClient;
  private readonly addrs: ChainAddresses;
  constructor(rpcUrl: string, chainId: number, addrs: ChainAddresses) {
    this.chainId = chainId;
    this.client = createPublicClient({ transport: rpcTransport(rpcUrl, { timeout: 10_000, retryCount: 1 }) }) as PublicClient;
    this.addrs = addrs;
  }
  async blockNumber() { return Number(await this.client.getBlockNumber()); }
  async block(n: number | "latest") {
    const b = n === "latest" ? await this.client.getBlock({ blockTag: "latest" }) : await this.client.getBlock({ blockNumber: BigInt(n) });
    return { number: Number(b.number), hash: b.hash as Hex, timestamp: Number(b.timestamp) };
  }
  async ownerOf(tokenId: string) {
    if (!this.addrs.counselNft) throw new Error("COUNSEL_NFT not configured");
    try {
      return getAddress(await this.client.readContract({ address: this.addrs.counselNft, abi: counselNFTAbi, functionName: "ownerOf", args: [BigInt(tokenId)] }));
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  }
  async nftTotalSupply() {
    if (!this.addrs.counselNft) return 0;
    return Number(await this.client.readContract({ address: this.addrs.counselNft, abi: counselNFTAbi, functionName: "totalSupply" }));
  }
  /** Multicall3 lives at the same address on most EVM chains; remembered as absent after the first failure. */
  private multicall3: boolean | null = null;
  async ownersOf(tokenIds: string[]): Promise<(Address | null | undefined)[]> {
    if (!this.addrs.counselNft) throw new Error("COUNSEL_NFT not configured");
    const nft = this.addrs.counselNft;
    if (this.multicall3 !== false) {
      try {
        const out: (Address | null | undefined)[] = [];
        for (let i = 0; i < tokenIds.length; i += 250) {
          const slice = tokenIds.slice(i, i + 250);
          const res = (await this.client.multicall({
            multicallAddress: MULTICALL3,
            allowFailure: true,
            contracts: slice.map((id) => ({ address: nft, abi: ownerOfAbi, functionName: "ownerOf", args: [BigInt(id)] })),
          })) as { status: "success" | "failure"; result?: unknown; error?: unknown }[];
          for (const r of res) out.push(r.status === "success" ? getAddress(r.result as Address) : notFound(r.error) ? null : undefined);
        }
        this.multicall3 = true;
        return out;
      } catch (e) {
        if (this.multicall3 === true) throw e; // it worked before: a transient RPC failure, not a missing contract
        this.multicall3 = false;
      }
    }
    const out: (Address | null | undefined)[] = new Array(tokenIds.length).fill(undefined);
    let i = 0;
    const worker = async () => {
      while (i < tokenIds.length) {
        const k = i++;
        try { out[k] = await this.ownerOf(tokenIds[k]); } catch { out[k] = undefined; }
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    return out;
  }
  async agent(agentId: string) {
    if (!this.addrs.identityRegistry) return null;
    try {
      const [owner, uri] = await Promise.all([
        this.client.readContract({ address: this.addrs.identityRegistry, abi: identityRegistryAbi, functionName: "ownerOf", args: [BigInt(agentId)] }),
        this.client.readContract({ address: this.addrs.identityRegistry, abi: identityRegistryAbi, functionName: "tokenURI", args: [BigInt(agentId)] }),
      ]);
      return { owner: getAddress(owner as string), uri: String(uri) };
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  }
  async call(to: Address, data: Hex, blockNumber?: number) {
    const r = await this.client.call({ to, data, blockNumber: blockNumber !== undefined ? BigInt(blockNumber) : undefined });
    return (r.data ?? "0x") as Hex;
  }
  async logCount(address: Address, topics: (Hex | null)[], fromBlock: number, toBlock: number) {
    let n = 0;
    const step = 10_000;
    for (let a = fromBlock; a <= toBlock; a += step) {
      const logs = await this.client.request({ method: "eth_getLogs", params: [{ address, topics, fromBlock: toHex(a), toBlock: toHex(Math.min(toBlock, a + step - 1)) }] as any });
      n += (logs as unknown[]).length;
    }
    return n;
  }
  async rawLogs(address: Address, topics: (Hex | null)[], fromBlock: number, toBlock: number): Promise<RawLog[]> {
    const out: RawLog[] = [];
    const step = 10_000;
    for (let a = Math.max(0, fromBlock); a <= toBlock; a += step) {
      const logs = (await this.client.request({ method: "eth_getLogs", params: [{ address, topics, fromBlock: toHex(a), toBlock: toHex(Math.min(toBlock, a + step - 1)) }] as any })) as { topics: Hex[]; data: Hex; blockNumber: Hex; transactionHash: Hex; logIndex: Hex }[];
      for (const l of logs) out.push({ topics: l.topics, data: l.data, blockNumber: Number(l.blockNumber), txHash: l.transactionHash, logIndex: Number(l.logIndex) });
    }
    return out;
  }
  balance(address: Address, blockNumber?: number) { return this.client.getBalance({ address, blockNumber: blockNumber !== undefined ? BigInt(blockNumber) : undefined }); }
  async getCode(address: Address) { return ((await this.client.getCode({ address })) ?? "0x") as Hex; }
  erc20Balance(token: Address, owner: Address) { return this.client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] }); }
  erc20TotalSupply(token: Address) { return this.client.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }); }
  erc20Allowance(token: Address, owner: Address, spender: Address) { return this.client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] }); }
  ethBalance(address: Address) { return this.client.getBalance({ address }); }
  async rewardUnallocated(asset: Address) {
    if (!this.addrs.rewardDistributor) throw new Error("REWARD_DISTRIBUTOR not configured");
    return this.client.readContract({ address: this.addrs.rewardDistributor, abi: rewardDistributorAbi, functionName: "unallocated", args: [asset] });
  }
  async rewardRootPosted(epoch: number, asset: Address) {
    if (!this.addrs.rewardDistributor) throw new Error("REWARD_DISTRIBUTOR not configured");
    const r = await this.client.readContract({ address: this.addrs.rewardDistributor, abi: rewardDistributorAbi, functionName: "roots", args: [BigInt(epoch), asset] });
    return (r as { root: Hex }).root !== `0x${"0".repeat(64)}`;
  }
  async factoryLaunchCount() {
    if (!this.addrs.projectFactory) throw new Error("PROJECT_FACTORY not configured");
    return Number(await this.client.readContract({ address: this.addrs.projectFactory, abi: projectFactoryAbi, functionName: "launchCount" }));
  }
  async launchedEvent(txHash: Hex): Promise<LaunchedEvent | null> {
    const r = await this.client.getTransactionReceipt({ hash: txHash });
    for (const log of r.logs) {
      if (this.addrs.projectFactory && log.address.toLowerCase() !== this.addrs.projectFactory.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: projectFactoryAbi, data: log.data, topics: log.topics });
        if (ev.eventName !== "Launched") continue;
        const a = ev.args as any;
        return {
          launchId: Number(a.launchId), kind: Number(a.kind), token: getAddress(a.token), paired: getAddress(a.paired), poolId: a.poolId as Hex,
          poolAmount: String(a.poolAmount), contributorAmount: String(a.contributorAmount), remainderAmount: String(a.remainderAmount), remainderTo: getAddress(a.remainderTo),
          txHash, blockNumber: Number(r.blockNumber),
        };
      } catch { /* other event */ }
    }
    return null;
  }
  readContract<T>(address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) {
    return this.client.readContract({ address, abi, functionName, args } as any) as Promise<T>;
  }
  async events(address: Address, abi: Abi, fromBlock: number, toBlock: number): Promise<ChainEvent[]> {
    const out: ChainEvent[] = [];
    const step = 10_000;
    for (let a = Math.max(0, fromBlock); a <= toBlock; a += step) {
      const logs = await this.client.getLogs({ address, fromBlock: BigInt(a), toBlock: BigInt(Math.min(toBlock, a + step - 1)) });
      for (const l of logs) {
        try {
          const ev = decodeEventLog({ abi, data: l.data, topics: l.topics }) as unknown as { eventName: string; args: Record<string, unknown> };
          out.push({ eventName: ev.eventName, args: ev.args, blockNumber: Number(l.blockNumber), txHash: l.transactionHash as Hex, logIndex: Number(l.logIndex) });
        } catch { /* not in this abi */ }
      }
    }
    return out;
  }
}

/** Serialises async jobs (one signing key = one nonce stream). */
class Queue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(fn, fn);
    this.tail = p.catch(() => undefined);
    return p;
  }
}

export class ViemWriter implements ChainWriter {
  readonly address: Address;
  private readonly wallet: any;
  private readonly pub: PublicClient;
  private readonly addrs: ChainAddresses;
  private readonly queue = new Queue();
  constructor(rpcUrl: string, chainId: number, key: Hex, addrs: ChainAddresses) {
    const account = privateKeyToAccount(key);
    this.address = account.address;
    const chain = { id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: rpcUrls(rpcUrl) } } } as const;
    this.wallet = createWalletClient({ account, chain, transport: rpcTransport(rpcUrl, { timeout: 30_000 }) });
    this.pub = createPublicClient({ chain, transport: rpcTransport(rpcUrl, { timeout: 30_000 }) }) as PublicClient;
    this.addrs = addrs;
  }
  /** simulate (so reverts surface with their reason) → send → wait; one transaction at a time. */
  private send(to: Address, abi: any, functionName: string, args: unknown[]): Promise<TxResult> {
    return this.queue.run(async () => {
      const { request } = await this.pub.simulateContract({ account: this.wallet.account, address: to, abi, functionName, args } as any);
      const hash = await this.wallet.writeContract(request);
      const r = await this.pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
      return { txHash: hash as Hex, blockNumber: Number(r.blockNumber), status: r.status as "success" | "reverted", gasUsed: r.gasUsed.toString() };
    });
  }
  async permit2Settle(a: SettleArgs) {
    const r = await this.send(this.addrs.permit2, permit2Abi, "permitWitnessTransferFrom", [
      { permitted: { token: a.auth.permitted.token, amount: BigInt(a.auth.permitted.amount) }, nonce: BigInt(a.auth.nonce), deadline: BigInt(a.auth.deadline) },
      { to: a.payTo, requestedAmount: a.amount },
      a.auth.from,
      witnessHash(a.auth.witness),
      WITNESS_TYPE_STRING,
      a.signature,
    ]);
    return { txHash: r.txHash, blockNumber: r.blockNumber, status: r.status };
  }
  async giveFeedback(x: { agentId: bigint; value: bigint; valueDecimals?: number; tag1: string; tag2: string; endpoint: string; feedbackURI: string; feedbackHash: Hex }) {
    if (!this.addrs.reputationRegistry) throw new Error("REPUTATION_REGISTRY not configured");
    const r = await this.send(this.addrs.reputationRegistry, reputationRegistryAbi, "giveFeedback", [x.agentId, x.value, x.valueDecimals ?? 0, x.tag1, x.tag2, x.endpoint, x.feedbackURI, x.feedbackHash]);
    if (r.status !== "success") throw new Error(`giveFeedback reverted in ${r.txHash}`);
    return { txHash: r.txHash, blockNumber: r.blockNumber, gasUsed: r.gasUsed };
  }
  async postRoot(epoch: bigint, asset: Address, root: Hex, total: bigint) {
    if (!this.addrs.rewardDistributor) throw new Error("REWARD_DISTRIBUTOR not configured");
    const r = await this.send(this.addrs.rewardDistributor, rewardDistributorAbi, "postRoot", [epoch, asset, root, total]);
    if (r.status !== "success") throw new Error(`postRoot reverted in ${r.txHash}`);
    return r;
  }
}

/** A chain that is not configured: every read fails with chain_unavailable (callers turn that into 503). */
export class NoChain implements ChainReader {
  readonly configured = false;
  readonly chainId: number;
  constructor(chainId: number) { this.chainId = chainId; }
  private no(): never { throw new ChainUnavailable("RPC_URL not configured"); }
  blockNumber(): Promise<number> { return this.no(); }
  block(): Promise<BlockInfo> { return this.no(); }
  ownerOf(): Promise<Address | null> { return this.no(); }
  nftTotalSupply(): Promise<number> { return this.no(); }
  agent(): Promise<{ owner: Address; uri: string } | null> { return this.no(); }
  call(): Promise<Hex> { return this.no(); }
  logCount(): Promise<number> { return this.no(); }
  balance(): Promise<bigint> { return this.no(); }
  getCode(): Promise<Hex> { return this.no(); }
  erc20Balance(): Promise<bigint> { return this.no(); }
  erc20TotalSupply(): Promise<bigint> { return this.no(); }
  erc20Allowance(): Promise<bigint> { return this.no(); }
  ethBalance(): Promise<bigint> { return this.no(); }
  rewardUnallocated(): Promise<bigint> { return this.no(); }
  rewardRootPosted(): Promise<boolean> { return this.no(); }
  factoryLaunchCount(): Promise<number> { return this.no(); }
  launchedEvent(): Promise<LaunchedEvent | null> { return this.no(); }
  readContract<T>(): Promise<T> { return this.no(); }
  events(): Promise<ChainEvent[]> { return this.no(); }
}

export class ChainUnavailable extends Error {}

/** An RPC client puts the endpoint it called into its error text — and the endpoint carries the API key in its path.
 *  Those messages travel: into a payment's `reason`, into /health's failedReasons, back to whoever filed the request.
 *  That is how our Alchemy key reached a user. Everything user-facing goes through here; the server log keeps the
 *  original. Hosts are kept because knowing *which* endpoint failed is the useful half. */
export function redactRpc(text: unknown): string {
  return String(text ?? "")
    .replace(/(https?:\/\/)([^\s/"')]+)\/[^\s"')]*/gi, (_m, scheme: string, host: string) => `${scheme}${host}/<redacted>`)
    .replace(/\b(alch|sk|pk|key)[-_][A-Za-z0-9_-]{8,}/gi, "<redacted>");
}

/** Deterministic in-memory chain for tests and the demo. */
export class MockChain implements ChainReader {
  readonly configured = true;
  readonly chainId: number;
  head = 1_000_000;
  owners = new Map<string, Address>();
  agents = new Map<string, { owner: Address; uri: string }>();
  balances = new Map<string, bigint>();
  codes = new Map<string, Hex>();
  calls = new Map<string, Hex>();
  logs = new Map<string, number>();
  tokenBalances = new Map<string, bigint>();
  allowances = new Map<string, bigint>();
  unallocated = new Map<string, bigint>();
  launchCount = 0;
  launches = new Map<string, LaunchedEvent>();
  failOwnerReads = false;
  /** ERC-8004 agent ids start at 0 in the vendored IdentityRegistry. */
  private nextAgent = 0;
  constructor(chainId = 46630) { this.chainId = chainId; }

  blockHash(n: number): Hex { return keccak256(toHex(`block-${n}`)); }
  async blockNumber() { return this.head; }
  async block(n: number | "latest") {
    const num = n === "latest" ? this.head : n;
    return { number: num, hash: this.blockHash(num), timestamp: 1_790_000_000 + num * 2 };
  }
  async ownerOf(tokenId: string) {
    if (this.failOwnerReads) throw new ChainUnavailable("mock: ownerOf unavailable");
    return this.owners.get(tokenId) ?? null;
  }
  async nftTotalSupply() { return this.owners.size; }
  async agent(agentId: string) { return this.agents.get(agentId) ?? null; }
  /** Simulate IdentityRegistry.register(agentURI) by `owner`. */
  register(owner: Address, uri: string): string {
    const id = String(this.nextAgent++);
    this.agents.set(id, { owner: getAddress(owner), uri });
    return id;
  }
  async call(to: Address, data: Hex) { return this.calls.get(`${to.toLowerCase()}:${data}`) ?? ("0x" + "0".repeat(64)) as Hex; }
  async logCount(address: Address, topics: (Hex | null)[]) { return this.logs.get(`${address.toLowerCase()}:${topics[0] ?? ""}`) ?? 0; }
  async balance(address: Address) { return this.balances.get(address.toLowerCase()) ?? 0n; }
  async getCode(address: Address) { return this.codes.get(address.toLowerCase()) ?? "0x"; }
  async erc20Balance(token: Address, owner: Address) { return this.tokenBalances.get(`${token.toLowerCase()}:${owner.toLowerCase()}`) ?? 10n ** 30n; }
  async erc20TotalSupply(_token: Address) { return 10n ** 27n; }
  async erc20Allowance(token: Address, owner: Address, spender: Address) { return this.allowances.get(`${token.toLowerCase()}:${owner.toLowerCase()}:${spender.toLowerCase()}`) ?? 10n ** 30n; }
  async ethBalance() { return 10n ** 18n; }
  async rewardUnallocated(asset: Address) { return this.unallocated.get(asset.toLowerCase()) ?? 10n ** 30n; }
  async rewardRootPosted() { return false; }
  async factoryLaunchCount() { return this.launchCount; }
  async launchedEvent(txHash: Hex) { return this.launches.get(txHash.toLowerCase()) ?? null; }
  /** views by `${address}:${functionName}` or, per argument list, `${address}:${functionName}(${args})` (lowercase) */
  views = new Map<string, unknown>();
  logsByAddress = new Map<string, ChainEvent[]>();
  async readContract<T>(address: Address, _abi: Abi, functionName: string, args: readonly unknown[] = []) {
    const withArgs = `${address.toLowerCase()}:${functionName}(${args.map((a) => String(a).toLowerCase()).join(",")})`;
    if (this.views.has(withArgs)) return this.views.get(withArgs) as T;
    const k = `${address.toLowerCase()}:${functionName}`;
    if (!this.views.has(k) && functionName === "decimals") return 18 as T; // any ERC-20 in the mock chain is 18-dec unless a test says otherwise
    if (!this.views.has(k)) throw new Error(`mock: no view ${functionName} on ${address}`);
    return this.views.get(k) as T;
  }
  async events(address: Address, _abi: Abi, fromBlock: number, toBlock: number) {
    return (this.logsByAddress.get(address.toLowerCase()) ?? []).filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= toBlock);
  }
}

/** Records the settler's transactions instead of sending them (tests/demo). */
export class MockWriter implements ChainWriter {
  readonly address: Address;
  sent: { fn: string; args: unknown }[] = [];
  revertSettle = false;
  constructor(address: Address = "0x5e771e5e771e5e771e5e771e5e771e5e771e5e77") { this.address = getAddress(address); }
  private tx(fn: string, args: unknown): Hex {
    this.sent.push({ fn, args });
    return keccak256(toHex(`${fn}:${this.sent.length}:${JSON.stringify(args, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`));
  }
  async permit2Settle(a: SettleArgs) { return { txHash: this.tx("permitWitnessTransferFrom", a), blockNumber: 1, status: this.revertSettle ? ("reverted" as const) : ("success" as const) }; }
  async giveFeedback(x: any) { return { txHash: this.tx("giveFeedback", x), blockNumber: 1, gasUsed: "50000" }; }
  async postRoot(epoch: bigint, asset: Address, root: Hex, total: bigint) { return { txHash: this.tx("postRoot", { epoch, asset, root, total }), blockNumber: 1, status: "success" as const, gasUsed: "60000" }; }
}

export function decodeWord(data: Hex, as: "uint256" | "bool" | "address" | "bytes32"): string | boolean {
  const [v] = decodeAbiParameters([{ type: as }], data);
  return typeof v === "bigint" ? v.toString() : (v as string | boolean);
}

export { encodeFunctionData, zeroAddress };
