/**
 * EIP-712 typed data (wallet secp256k1 signatures):
 *
 *  - WorkerAuthorization  domain {name:"Company.md Worker", version:"1", chainId}
 *      the seat holder authorises one device key for one Counsel token (POST /pair/complete)
 *  - QuoteApproval        domain {name:"Company.md Paid Action", version:"1", chainId}
 *      the payer approves exactly one quote + one x402 payment payload (POST /requests/:id/submit)
 *  - OracleAttestation    domain {name:"Company.md Oracle", version:"1", chainId} — NO verifyingContract
 *      the attester signs an agreed panel answer once per chain; verified on-chain by
 *      contracts/src/oracle/OracleAttestationVerifier.sol (EIP712Domain(string name,string version,uint256 chainId))
 *  - Permit2 PermitWitnessTransferFrom with the x402 exact-permit2 witness Witness(address to,uint256 validAfter)
 */
import {
  encodeAbiParameters, getAddress, hashTypedData, keccak256, recoverTypedDataAddress, toHex,
  type Address, type Hex, type TypedDataDomain,
} from "viem";

export const WORKER_DOMAIN_NAME = "Company.md Worker";
export const PAID_ACTION_DOMAIN_NAME = "Company.md Paid Action";
export const ORACLE_DOMAIN_NAME = "Company.md Oracle";
export const DOMAIN_VERSION = "1";

// ------------------------------------------------------------------------------------ WorkerAuthorization

export const WorkerAuthorizationTypes = {
  WorkerAuthorization: [
    { name: "deviceKey", type: "bytes32" },
    { name: "wallet", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "nonce", type: "bytes32" },
    { name: "expiresAt", type: "uint64" },
    { name: "relayOrigin", type: "string" },
  ],
} as const;

/** JSON wire form (what /pair/complete receives as `message`). */
export interface WorkerAuthorizationMessage {
  deviceKey: Hex; // 0x + 64 hex
  wallet: Address;
  tokenId: string; // decimal
  nonce: Hex; // 0x + 64 hex
  expiresAt: number; // unix seconds
  relayOrigin: string;
}

export function workerAuthorizationTypedData(m: WorkerAuthorizationMessage, chainId: number) {
  return {
    domain: { name: WORKER_DOMAIN_NAME, version: DOMAIN_VERSION, chainId } as TypedDataDomain,
    types: WorkerAuthorizationTypes,
    primaryType: "WorkerAuthorization" as const,
    message: {
      deviceKey: m.deviceKey,
      wallet: getAddress(m.wallet),
      tokenId: BigInt(m.tokenId),
      nonce: m.nonce,
      expiresAt: BigInt(m.expiresAt),
      relayOrigin: m.relayOrigin,
    },
  };
}

// ------------------------------------------------------------------------------------ QuoteApproval

export const QuoteApprovalTypes = {
  QuoteApproval: [
    { name: "resource", type: "string" },
    { name: "requesterScopeHash", type: "bytes32" },
    { name: "quoteId", type: "string" },
    { name: "quoteHash", type: "bytes32" },
    { name: "paymentHash", type: "bytes32" },
    { name: "action", type: "string" },
    { name: "asset", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "payTo", type: "address" },
    { name: "expiresAt", type: "uint256" },
  ],
} as const;

export interface QuoteApprovalMessage {
  resource: string;
  requesterScopeHash: Hex;
  quoteId: string;
  quoteHash: Hex;
  paymentHash: Hex;
  action: string;
  asset: Address;
  amount: string;
  payTo: Address;
  expiresAt: number;
}

export function quoteApprovalTypedData(m: QuoteApprovalMessage, chainId: number) {
  return {
    domain: { name: PAID_ACTION_DOMAIN_NAME, version: DOMAIN_VERSION, chainId } as TypedDataDomain,
    types: QuoteApprovalTypes,
    primaryType: "QuoteApproval" as const,
    message: {
      resource: m.resource,
      requesterScopeHash: m.requesterScopeHash,
      quoteId: m.quoteId,
      quoteHash: m.quoteHash,
      paymentHash: m.paymentHash,
      action: m.action,
      asset: getAddress(m.asset),
      amount: BigInt(m.amount),
      payTo: getAddress(m.payTo),
      expiresAt: BigInt(m.expiresAt),
    },
  };
}

// ------------------------------------------------------------------------------------ OracleAttestation

export const OracleAttestationTypes = {
  OracleAttestation: [
    { name: "requestId", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "questionHash", type: "bytes32" },
    { name: "answerType", type: "string" },
    { name: "answer", type: "bytes" },
    { name: "figure", type: "uint256" },
    { name: "fromBlock", type: "uint256" },
    { name: "toBlock", type: "uint256" },
    { name: "blockHash", type: "bytes32" },
    { name: "panelJobId", type: "bytes32" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

export interface OracleAttestationMessage {
  requestId: Hex;
  chainId: number;
  questionHash: Hex;
  answerType: AnswerType;
  answer: Hex;
  figure: string;
  fromBlock: number;
  toBlock: number;
  blockHash: Hex;
  panelJobId: Hex;
  issuedAt: number;
  expiresAt: number;
}

/**
 * Oracle domain, exactly as OracleAttestationVerifier.sol: `EIP712Domain(string name,string version,uint256 chainId)`
 * with chainId = the chain where the attestation is VERIFIED (a consumer's chain). There is no verifyingContract:
 * one signature serves every consumer on that chain. The struct's own `chainId` is the chain the question is about.
 */
export function oracleDomain(chainId: number): TypedDataDomain {
  return { name: ORACLE_DOMAIN_NAME, version: DOMAIN_VERSION, chainId };
}

export function oracleAttestationTypedData(m: OracleAttestationMessage, domain: TypedDataDomain) {
  return {
    domain,
    types: OracleAttestationTypes,
    primaryType: "OracleAttestation" as const,
    message: {
      requestId: m.requestId,
      chainId: BigInt(m.chainId),
      questionHash: m.questionHash,
      answerType: m.answerType,
      answer: m.answer,
      figure: BigInt(m.figure),
      fromBlock: BigInt(m.fromBlock),
      toBlock: BigInt(m.toBlock),
      blockHash: m.blockHash,
      panelJobId: m.panelJobId,
      issuedAt: BigInt(m.issuedAt),
      expiresAt: BigInt(m.expiresAt),
    },
  };
}

export type AnswerType = "bool" | "address" | "bytes32" | "uint256" | "address[]" | "bytes32[]";
export const ANSWER_TYPES: AnswerType[] = ["bool", "address", "bytes32", "uint256", "address[]", "bytes32[]"];

/** JSON answer → ABI bytes (`abi.encode(value)`), the `answer` field of an attestation. */
export function encodeAnswer(answerType: AnswerType, answer: unknown): Hex {
  switch (answerType) {
    case "bool": return encodeAbiParameters([{ type: "bool" }], [answer === true]);
    case "address": return encodeAbiParameters([{ type: "address" }], [getAddress(String(answer))]);
    case "bytes32": return encodeAbiParameters([{ type: "bytes32" }], [String(answer) as Hex]);
    case "uint256": return encodeAbiParameters([{ type: "uint256" }], [BigInt(String(answer))]);
    case "address[]": return encodeAbiParameters([{ type: "address[]" }], [(answer as string[]).map((a) => getAddress(a))]);
    case "bytes32[]": return encodeAbiParameters([{ type: "bytes32[]" }], [answer as Hex[]]);
  }
}

/** UUID → bytes32 the way IMD does it: the 16 uuid bytes left-aligned, zero padded. */
export function uuidToBytes32(uuid: string): Hex {
  const hex = uuid.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`not a uuid: ${uuid}`);
  return `0x${hex}${"0".repeat(32)}`;
}

export function questionHash(question: string): Hex {
  return keccak256(toHex(question));
}

// ------------------------------------------------------------------------------------ Permit2 (x402 exact)

export const PERMIT2_ADDRESS: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export const PermitWitnessTransferFromTypes = {
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "Witness" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  Witness: [
    { name: "to", type: "address" },
    { name: "validAfter", type: "uint256" },
  ],
} as const;

/** Witness type string passed to Permit2.permitWitnessTransferFrom (types after `Witness witness)` sorted per EIP-712). */
export const WITNESS_TYPE_STRING = "Witness witness)TokenPermissions(address token,uint256 amount)Witness(address to,uint256 validAfter)";

export interface Permit2Authorization {
  from: Address;
  permitted: { token: Address; amount: string };
  spender: Address;
  nonce: string;
  deadline: number;
  witness: { to: Address; validAfter: number };
}

export function permit2TypedData(a: Permit2Authorization, chainId: number, permit2: Address = PERMIT2_ADDRESS) {
  return {
    domain: { name: "Permit2", chainId, verifyingContract: getAddress(permit2) } as TypedDataDomain,
    types: PermitWitnessTransferFromTypes,
    primaryType: "PermitWitnessTransferFrom" as const,
    message: {
      permitted: { token: getAddress(a.permitted.token), amount: BigInt(a.permitted.amount) },
      spender: getAddress(a.spender),
      nonce: BigInt(a.nonce),
      deadline: BigInt(a.deadline),
      witness: { to: getAddress(a.witness.to), validAfter: BigInt(a.witness.validAfter) },
    },
  };
}

/** hashStruct(Witness) — the `witness` argument of permitWitnessTransferFrom. */
export function witnessHash(w: { to: Address; validAfter: number }): Hex {
  const typeHash = keccak256(toHex("Witness(address to,uint256 validAfter)"));
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "uint256" }], [typeHash, getAddress(w.to), BigInt(w.validAfter)]));
}

// ------------------------------------------------------------------------------------ helpers

/** Recover the signer; null on malformed signatures instead of throwing. */
export async function recoverTypedSigner(td: { domain: TypedDataDomain; types: any; primaryType: string; message: any }, signature: string): Promise<Address | null> {
  try {
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return null;
    return await recoverTypedDataAddress({ ...td, signature: signature as Hex } as any);
  } catch {
    return null;
  }
}

export function typedDataDigest(td: { domain: TypedDataDomain; types: any; primaryType: string; message: any }): Hex {
  return hashTypedData(td as any);
}

/** bigint-safe JSON form of a typed-data object for HTTP responses (wallets accept decimal strings). */
export function typedDataJson(td: { domain: TypedDataDomain; types: any; primaryType: string; message: any }) {
  const conv = (v: unknown): unknown => (typeof v === "bigint" ? (v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()) : v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)])) : v);
  return { domain: conv(td.domain), types: { EIP712Domain: domainFields(td.domain), ...td.types }, primaryType: td.primaryType, message: conv(td.message) };
}

function domainFields(d: TypedDataDomain) {
  const f: { name: string; type: string }[] = [];
  if (d.name !== undefined) f.push({ name: "name", type: "string" });
  if (d.version !== undefined) f.push({ name: "version", type: "string" });
  if (d.chainId !== undefined) f.push({ name: "chainId", type: "uint256" });
  if (d.verifyingContract !== undefined) f.push({ name: "verifyingContract", type: "address" });
  return f;
}
