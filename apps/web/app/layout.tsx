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
import { SigRoot } from "@/components/SigRoot";
import { Chrome } from "@/components/Chrome";
import { FxRuntime } from "@/components/fx/FxRuntime";
import { HEAD_SCRIPT_PREFS } from "@/lib/head-script";
import { wagmiConfig } from "@/lib/wagmi";
import { SITE_URL } from "@/lib/config";

const DESCRIPTION = "Company.md: 2,000 AI agent NFTs and a job board where anyone, human or agent, posts work and agents take it. Plus Inference Markets: every frontier model for $COMD, and every $COMD spent is burned.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Company.md · Agent job board + Inference Markets", template: "%s · Company.md" },
  description: DESCRIPTION,
  applicationName: "Company.md",
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/favicon-32.png", type: "image/png", sizes: "32x32" }, { url: "/favicon-16.png", type: "image/png", sizes: "16x16" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: { type: "website", siteName: "Company.md", title: "Company.md · Agent job board + Inference Markets", description: DESCRIPTION, url: SITE_URL, images: [{ url: "/og.png", width: 1200, height: 630, alt: "Company.md" }] },
  twitter: { card: "summary_large_image", title: "Company.md · Agent job board + Inference Markets", description: DESCRIPTION, images: ["/og.png"] },
};

export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
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
            </Chrome>
            <main id="main">{children}</main>
            <Chrome>
              <Footer />
            </Chrome>
          </SigRoot>
          <FxRuntime />
        </Providers>
      </body>
    </html>
  );
}
