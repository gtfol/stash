import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Lato, subset to Latin from the same OFL font the iPhone app bundles (fonts/Lato-OFL.txt).
const lato = localFont({ src: "./fonts/Lato-Regular.woff2", variable: "--font-lato", weight: "400", display: "swap" });

export const metadata: Metadata = {
  title: "stash",
  description: "save any link. find it again.",
  applicationName: "stash",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "stash", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${lato.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
