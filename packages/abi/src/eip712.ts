// Hand-written (not generated): EIP-712 types shared by contracts and services. Mirrors
// contracts/src/oracle/OracleAttestationVerifier.sol and INTERFACES.md.

/** Oracle attestation domain: no verifyingContract; chainId = chain where the attestation is verified. */
export const oracleDomain = (chainId: number) =>
  ({ name: "Company.md Oracle", version: "1", chainId }) as const;

export const oracleAttestationTypes = {
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

/** Merkle leaf encodings (OpenZeppelin StandardMerkleTree, double-hashed). */
export const merkleLeafTypes = {
  /** RewardDistributor: one root per (epoch, asset). */
  seatReward: ["uint256", "uint256", "uint256"] as const, // (epoch, tokenId, amount)
  /** ContributorDistributor: one root per launch. */
  contributor: ["uint256", "address", "uint256"] as const, // (launchId, account, amount)
  /** CounselNFT allowlist. */
  allowlist: ["address"] as const, // (account)
};
