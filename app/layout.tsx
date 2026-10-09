import type { Metadata } from "next";
import "./globals.css";

const rawUrl = process.env.NEXT_PUBLIC_SITE_URL;
const metadataBase =
  rawUrl && (rawUrl.startsWith("http://") || rawUrl.startsWith("https://"))
    ? new URL(rawUrl)
    : new URL("http://localhost:3000");

export const metadata: Metadata = {
  metadataBase,
  title: "Thoddoo Marine Excursion Centre | Thoddoo, Maldives",
  description:
    "Your trips partner in Thoddoo, Ari Atoll — turtle, manta, reef and whale shark snorkeling, island hops, sandbanks, fishing, cruises and beach dinners.",
  icons: { icon: "/images/favicon.png" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Sora:wght@400;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
