import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Omega Protection Services", template: "%s · Omega Protection Services" },
  description: "Omega Protection Services operations portal: guards, sites, shifts, attendance and incidents, run over two-way SMS.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
