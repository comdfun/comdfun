/**
 * OpenZeppelin-compatible Merkle trees (same construction as @openzeppelin/merkle-tree StandardMerkleTree
 * with sortLeaves=true): leaf = keccak256(bytes.concat(keccak256(abi.encode(values...)))), leaves sorted
 * ascending by hash, laid out in a complete binary tree array, parent = commutative keccak256.
 *
 *  RewardDistributor      leaf (uint256 epoch, uint256 tokenId, uint256 amount)
 *  ContributorDistributor leaf (uint256 launchId, address account, uint256 amount)
 *
 * Both verify on-chain with MerkleProof.verify(proof, root, leaf).
 */
import { concat, encodeAbiParameters, getAddress, keccak256, type Hex } from "viem";

export function standardLeaf(types: string[], values: readonly unknown[]): Hex {
  const inner = keccak256(encodeAbiParameters(types.map((type) => ({ type })), values as unknown[]));
  return keccak256(inner);
}

export function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

export class StandardTree<V extends readonly unknown[]> {
  readonly tree: Hex[];
  readonly values: V[];
  private readonly index = new Map<string, number>();
  readonly types: string[];

  constructor(types: string[], values: V[]) {
    this.types = types;
    if (values.length === 0) throw new Error("empty merkle tree");
    this.values = values;
    const leaves = values.map((v) => ({ v, h: standardLeaf(types, v) }));
    const seen = new Set<string>();
    for (const l of leaves) {
      if (seen.has(l.h)) throw new Error("duplicate leaf");
      seen.add(l.h);
    }
    leaves.sort((a, b) => (BigInt(a.h) < BigInt(b.h) ? -1 : BigInt(a.h) > BigInt(b.h) ? 1 : 0));
    const tree: Hex[] = new Array(2 * leaves.length - 1);
    leaves.forEach((l, i) => {
      const at = tree.length - 1 - i;
      tree[at] = l.h;
      this.index.set(l.h, at);
    });
    for (let i = tree.length - 1 - leaves.length; i >= 0; i--) tree[i] = hashPair(tree[2 * i + 1], tree[2 * i + 2]);
    this.tree = tree;
  }

  get root(): Hex {
    return this.tree[0];
  }

  leafHash(v: V): Hex {
    return standardLeaf(this.types, v);
  }

  proof(v: V): Hex[] {
    let i = this.index.get(this.leafHash(v));
    if (i === undefined) throw new Error("value not in tree");
    const proof: Hex[] = [];
    while (i > 0) {
      proof.push(this.tree[i % 2 === 1 ? i + 1 : i - 1]);
      i = Math.floor((i - 1) / 2);
    }
    return proof;
  }
}

/** Mirror of OZ MerkleProof.verify. */
export function verifyProof(proof: Hex[], root: Hex, leaf: Hex): boolean {
  let h = leaf;
  for (const p of proof) h = hashPair(h, p);
  return h.toLowerCase() === root.toLowerCase();
}

// ------------------------------------------------------------------------------------------- rewards

export interface RewardEntry { epoch: number; tokenId: string; amount: string }
export const REWARD_LEAF_TYPES = ["uint256", "uint256", "uint256"];

export function rewardLeaf(e: RewardEntry): Hex {
  return standardLeaf(REWARD_LEAF_TYPES, [BigInt(e.epoch), BigInt(e.tokenId), BigInt(e.amount)]);
}

export function buildRewardTree(entries: RewardEntry[]) {
  const vals = entries.map((e) => [BigInt(e.epoch), BigInt(e.tokenId), BigInt(e.amount)] as const);
  const t = new StandardTree<readonly [bigint, bigint, bigint]>(REWARD_LEAF_TYPES, vals);
  return {
    root: t.root,
    claims: entries.map((e, i) => ({ ...e, leaf: t.leafHash(vals[i]), proof: t.proof(vals[i]) })),
  };
}

export interface ContributorEntry { launchId: number | string; account: string; amount: string }
export const CONTRIBUTOR_LEAF_TYPES = ["uint256", "address", "uint256"];

export function contributorLeaf(e: ContributorEntry): Hex {
  return standardLeaf(CONTRIBUTOR_LEAF_TYPES, [BigInt(e.launchId), getAddress(e.account), BigInt(e.amount)]);
}

export function buildContributorTree(entries: ContributorEntry[]) {
  const vals = entries.map((e) => [BigInt(e.launchId), getAddress(e.account), BigInt(e.amount)] as const);
  const t = new StandardTree<readonly [bigint, `0x${string}`, bigint]>(CONTRIBUTOR_LEAF_TYPES, vals);
  return {
    root: t.root,
    claims: entries.map((e, i) => ({ ...e, account: getAddress(e.account), leaf: t.leafHash(vals[i]), proof: t.proof(vals[i]) })),
  };
}
