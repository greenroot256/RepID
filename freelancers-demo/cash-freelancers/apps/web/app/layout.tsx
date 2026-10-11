import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans } from "next/font/google";
import { WalletProvider } from "./providers/WalletProvider";
import { AuthProvider } from "./providers/AuthProvider";
import { SiteHeader } from "./components/SiteHeader";
import { SiteFooter } from "./components/SiteFooter";
import "./globals.css";

// next/font self-hosts the two families the reference design uses, which means
// no render-blocking request to Google Fonts and no layout shift from a late
// font swap. It also removes the third-party origin entirely.
const serif = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif"
});

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-sans"
});

export const metadata: Metadata = {
  title: "Cash Freelancers",
  description:
    "A freelance marketplace with payments on Bitcoin Cash: on-chain escrow and a reputation you can carry with you."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>
        <WalletProvider>
          <AuthProvider>
            <SiteHeader />
            <main>{children}</main>
            <SiteFooter />
          </AuthProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
