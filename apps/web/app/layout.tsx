import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "STEP Explorer",
  description:
    "Public transparency dashboard for the STEP proof-of-presence MESH: triangles, claims, campaigns, treasury, validators.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        <header className="border-b border-neutral-800 px-6 py-4">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 text-sm">
            <Link href="/" className="font-semibold tracking-wide text-emerald-400">
              STEP<span className="text-neutral-400">/explorer</span>
            </Link>
            <Link href="/mesh" className="text-neutral-300 hover:text-white">
              MESH map
            </Link>
            <Link href="/treasury" className="text-neutral-300 hover:text-white">
              Treasury
            </Link>
            <Link href="/validators" className="text-neutral-300 hover:text-white">
              Validators
            </Link>
            <span className="ml-auto rounded bg-amber-900/60 px-2 py-1 text-xs text-amber-300">
              internal testnet — Trinity has no monetary value
            </span>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        <footer className="border-t border-neutral-800 px-6 py-4 text-center text-xs text-neutral-500">
          STEP alpha · proof-of-presence on a spherical triangular MESH · map data ©
          OpenStreetMap contributors
        </footer>
      </body>
    </html>
  );
}
