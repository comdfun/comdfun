// Stand-in values for chain reads when NEXT_PUBLIC_MOCK=1 and a contract address is not configured. Client-safe.
// Every number shown from here is labelled "mock" in the UI.
const E18 = 10n ** 18n;
export const MOCK_CHAIN = {
  counsel: { maxSupply: 2000n, totalSupply: 1402n, phase: 2, price: 0n, maxPerWallet: 2n, mintedBy: 0n },
  token: { totalSupply: 998_412_336n * E18, initialSupply: 1_000_000_000n * E18, balance: 0n },
  swap: { comdPerEth: 412_000n, taxBps: 500 },
  comd: { balance: 0n, allowance: 0n },
  stake: { totalAssets: 46_210_400n * E18, totalShares: 44_980_000n * E18 * 1_000_000n, ratePerSecond: 244_840_000_000_000_000n, streamCapPerDay: 250_000n * E18 },
  bond: { enabled: true, priceEth: 10n ** 10n, reserve: 796_174n * E18 },
  incorporations: [
    { address: "0x1a00000000000000000000000000000000000001", name: "Habeas Corpus", symbol: "HABEAS", creator: "0x9fad00000000000000000000000000000000f63f", metadataURI: "", supplySold: 0.42, comdReserve: 1_822_000, trades: 311, createdAgo: 2 },
    { address: "0x1a00000000000000000000000000000000000002", name: "Amicus", symbol: "AMICUS", creator: "0x5167000000000000000000000000000000003281", metadataURI: "", supplySold: 0.18, comdReserve: 641_000, trades: 97, createdAgo: 5 },
    { address: "0x1a00000000000000000000000000000000000003", name: "Pro Bono", symbol: "PROBONO", creator: "0x5b95000000000000000000000000000000000d06", metadataURI: "", supplySold: 0.71, comdReserve: 4_091_800, trades: 1_204, createdAgo: 9 },
    { address: "0x1a00000000000000000000000000000000000004", name: "Res Judicata", symbol: "RESJ", creator: "0x424f000000000000000000000000000000c755", metadataURI: "", supplySold: 0.06, comdReserve: 112_000, trades: 18, createdAgo: 14 },
    { address: "0x1a00000000000000000000000000000000000005", name: "Voir Dire", symbol: "VOIR", creator: "0xbb14000000000000000000000000000000f1c5", metadataURI: "", supplySold: 0.33, comdReserve: 1_200_400, trades: 240, createdAgo: 22 },
    { address: "0x1a00000000000000000000000000000000000006", name: "Stare Decisis", symbol: "STARE", creator: "0xfc2d00000000000000000000000000000000ad14", metadataURI: "", supplySold: 0.91, comdReserve: 6_130_200, trades: 2_870, createdAgo: 31 },
  ],
};
