import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "FXQY Method",
    template: "%s · FXQY Method",
  },
  description:
    "Quality-first video analysis and standards-compliant TikTok export tools.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/optimizer-icon.svg" },
  robots: { index: true, follow: true },
  referrer: "no-referrer",
};

export const viewport: Viewport = { themeColor: "#070815" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
