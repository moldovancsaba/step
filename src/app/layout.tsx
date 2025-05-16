import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "STEP - Triangle Mesh Visualization System",
  description: "Interactive triangle mesh visualization for OpenStreetMap with geographic subdivision capabilities",
  keywords: ["triangle mesh", "geographic visualization", "OpenStreetMap", "interactive map", "subdivision"],
  authors: [{ name: "STEP Team" }],
  creator: "STEP Project",
  publisher: "Vercel",
  robots: "index, follow",
  
  // OpenGraph metadata for social sharing
  openGraph: {
    title: "STEP - Triangle Mesh Visualization System",
    description: "Interactive triangle mesh visualization for OpenStreetMap with geographic subdivision",
    url: "https://step-project.vercel.app",
    siteName: "STEP Project",
    images: [
      {
        url: "https://step-project.vercel.app/og-image.png",
        width: 1200,
        height: 630,
        alt: "STEP Triangle Mesh Visualization",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  
  // Twitter card
  twitter: {
    card: "summary_large_image",
    title: "STEP - Triangle Mesh Visualization System",
    description: "Interactive triangle mesh visualization for OpenStreetMap",
    images: ["https://step-project.vercel.app/og-image.png"],
  },
  
  // Viewport settings
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  },
  
  // Icons
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  
  // Verification
  verification: {
    google: "google-site-verification=VERIFICATION_CODE", // Replace with actual verification code if needed
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* OpenStreetMap specific metatags */}
        <meta name="referrer" content="no-referrer-when-downgrade" />
        <meta name="format-detection" content="telephone=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha512-Zcn6fTEZJLuBnXKNlYvJlOPutjGHQBaVLnQsmC/J8wKmEeKcIiHAagwiyYVSwdRnJ7d4r+2P8d5+lXLQ2TuYQ==" crossOrigin="" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
