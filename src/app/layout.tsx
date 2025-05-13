import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'STEP - Sphere Triangular Earth Project',
  description: 'Interactive 3D world representation based on an icosahedron-mapped sphere',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}

