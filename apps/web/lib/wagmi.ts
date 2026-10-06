import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { robinhood, robinhoodTestnet, activeChain, rpcTransport } from "./chains";
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
    [robinhood.id]: activeChain.id === robinhood.id ? rpcTransport() : http(),
    [robinhoodTestnet.id]: activeChain.id === robinhoodTestnet.id ? rpcTransport() : http(),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
