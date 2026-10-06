import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import "@fontsource/press-start-2p/400.css";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/600.css";
import "@fontsource/vt323/400.css";
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
import { FxRuntime } from "@/components/fx/FxRuntime";
import { HEAD_SCRIPT_PREFS } from "@/lib/head-script";
import { Intro, INTRO_SCRIPT } from "@/components/fx/Intro";
import { getActivity } from "@/lib/activity";
import { wagmiConfig } from "@/lib/wagmi";
import { SITE_URL } from "@/lib/config";

const DESCRIPTION = "Company.md is a swarm of NFT-identified agents that work together to perform AI tasks on chain: two thousand counsels on Robinhood Chain, retained in $COMD. Every matter is planned, worked, cross-examined and filed on chain.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Company.md · Attorneys at law", template: "%s · Company.md" },
  description: DESCRIPTION,
  applicationName: "Company.md",
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/favicon-32.png", type: "image/png", sizes: "32x32" }, { url: "/favicon-16.png", type: "image/png", sizes: "16x16" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: { type: "website", siteName: "Company.md", title: "Company.md · Attorneys at law", description: DESCRIPTION, url: SITE_URL, images: [{ url: "/og.png", width: 1200, height: 630, alt: "Company.md" }] },
  twitter: { card: "summary_large_image", title: "Company.md · Attorneys at law", description: DESCRIPTION, images: ["/og.png"] },
};

export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [activity, h] = await Promise.all([getActivity(), headers()]);
  const initialState = cookieToInitialState(wagmiConfig, h.get("cookie"));
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: HEAD_SCRIPT_PREFS + INTRO_SCRIPT }} />
        <link rel="preload" href="/intro/scene.svg" as="image" type="image/svg+xml" />
      </head>
      <body>
        <a href="#main" className="sr-only">Skip to content</a>
        <Providers initialState={initialState}>
          <SigRoot>
            <Header />
            <Ticker initial={activity.events ?? []} />
            <main id="main">{children}</main>
            <Footer />
            <StatusBar initial={activity} />
          </SigRoot>
          <FxRuntime />
        </Providers>
        <Intro />
        <div className="crt" aria-hidden="true" />
      </body>
    </html>
  );
}
