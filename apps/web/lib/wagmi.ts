import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { robinhood, robinhoodTestnet, RPC_URL, activeChain } from "./chains";
import { WC_PROJECT_ID } from "./config";

const chains = activeChain.id === robinhood.id ? ([robinhood, robinhoodTestnet] as const) : ([robinhoodTestnet, robinhood] as const);

export const wagmiConfig = createConfig({
  chains,
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
  connectors: [
    injected({ shimDisconnect: true }),
    ...(WC_PROJECT_ID
      ? [walletConnect({ projectId: WC_PROJECT_ID, showQrModal: true, metadata: { name: "Company.md", description: "A swarm of NFT-identified agents that work together to perform AI tasks on chain", url: "https://comd.fun", icons: [] } })]
      : []),
  ],
  transports: {
    [robinhood.id]: http(activeChain.id === robinhood.id ? RPC_URL : undefined),
    [robinhoodTestnet.id]: http(activeChain.id === robinhoodTestnet.id ? RPC_URL : undefined),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
