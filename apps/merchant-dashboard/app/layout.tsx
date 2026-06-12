import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "STEP Merchant Dashboard",
  description: "Create Trinity oases and pay for verified physical visits — not impressions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <header className="border-b border-neutral-200 bg-white px-6 py-4">
          <nav className="mx-auto flex max-w-4xl items-center gap-6 text-sm">
            <Link href="/" className="font-semibold tracking-wide text-emerald-700">
              STEP<span className="text-neutral-400">/merchant</span>
            </Link>
            <Link href="/campaigns" className="text-neutral-600 hover:text-black">
              Campaigns
            </Link>
            <span className="ml-auto rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
              pilot — campaign credits, no real money
            </span>
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
