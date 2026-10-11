// the pixel faces are used only by the announcement films (/film); declared here so they are always available
import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import "@fontsource/press-start-2p/400.css";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/vt323/400.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { cookieToInitialState } from "wagmi";
import { Providers } from "./providers";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { StatusBar } from "@/components/StatusBar";
import { SigRoot } from "@/components/SigRoot";
import { Ticker } from "@/components/fx/Ticker";
import { Chrome } from "@/components/Chrome";
import { FxRuntime } from "@/components/fx/FxRuntime";
import { HEAD_SCRIPT_PREFS } from "@/lib/head-script";
import { getActivity } from "@/lib/activity";
import { wagmiConfig } from "@/lib/wagmi";
import { SITE_URL } from "@/lib/config";

const DESCRIPTION = "Company.md runs two desks: a swarm of two thousand NFT-identified Counsel that perform AI tasks on chain, and cICM, an inference capital markets desk where anyone buys every frontier model with $COMD. Every matter is planned, worked, cross-examined and filed on chain; every $COMD spent on inference is burned.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Company.md · Swarm + Inference Capital Markets", template: "%s · Company.md" },
  description: DESCRIPTION,
  applicationName: "Company.md",
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/favicon-32.png", type: "image/png", sizes: "32x32" }, { url: "/favicon-16.png", type: "image/png", sizes: "16x16" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: { type: "website", siteName: "Company.md", title: "Company.md · Swarm + Inference Capital Markets", description: DESCRIPTION, url: SITE_URL, images: [{ url: "/og.png", width: 1200, height: 630, alt: "Company.md" }] },
  twitter: { card: "summary_large_image", title: "Company.md · Swarm + Inference Capital Markets", description: DESCRIPTION, images: ["/og.png"] },
};

export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [activity, h] = await Promise.all([getActivity(), headers()]);
  const initialState = cookieToInitialState(wagmiConfig, h.get("cookie"));
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: HEAD_SCRIPT_PREFS }} />
      </head>
      <body>
        <a href="#main" className="sr-only">Skip to content</a>
        <Providers initialState={initialState}>
          <SigRoot>
            <Chrome>
              <Header />
              <Ticker initial={activity.events ?? []} />
            </Chrome>
            <main id="main">{children}</main>
            <Chrome>
              <Footer />
              <StatusBar initial={activity} />
            </Chrome>
          </SigRoot>
          <FxRuntime />
        </Providers>
      </body>
    </html>
  );
}
