import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ocean Distro Finder",
  description: "Track intelligence, distributor identification and cross-platform analytics.",
};

// Single pure-black theme — set before paint (no flash, white logo always).
const themeInit = `document.documentElement.dataset.theme='dark';`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInit }} /></head>
      <body>{children}</body>
    </html>
  );
}
