import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Virus Records — License Panel",
  description: "Issue and audit the keys that unlock the Virus Records desktop app.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
