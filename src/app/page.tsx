import { Suspense } from 'react';
import dynamic from 'next/dynamic';

// Import Map component dynamically to avoid SSR issues with Leaflet
const MapComponent = dynamic(() => import('@/components/Map/MapComponent'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-screen">Loading map...</div>
});

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between">
      <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading map...</div>}>
        <MapComponent />
      </Suspense>
    </main>
  );
}

