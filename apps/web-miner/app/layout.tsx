import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "STEP Miner",
  description: "Mine Trinity by proving you are physically inside a spherical triangle.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        <div className="mx-auto max-w-md px-5 py-6">{children}</div>
      </body>
    </html>
  );
}
