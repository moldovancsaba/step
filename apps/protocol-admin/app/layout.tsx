import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "STEP Protocol Admin",
  description: "Foundation operations: safety, moderation, parameters, emergency controls.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        <header className="border-b border-red-900/50 bg-red-950/20 px-6 py-4">
          <div className="mx-auto flex max-w-5xl items-center gap-4 text-sm">
            <span className="font-semibold tracking-wide text-red-400">
              STEP<span className="text-neutral-500">/protocol-admin</span>
            </span>
            <span className="ml-auto rounded bg-red-900/60 px-2 py-1 text-xs text-red-200">
              foundation operators only — every action is publicly logged on-chain
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
