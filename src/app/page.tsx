'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useMeshStore } from './store/meshStore';

// Dynamically import MapComponent with no SSR
const MapComponent = dynamic(
  () => import('./components/Map'),
  { 
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gray-900 mb-4"></div>
          <p>Loading map...</p>
        </div>
      </div>
    )
  }
);

export default function Home() {
  const [center, setCenter] = useState<[number, number]>([0, 0]);
  const [zoom, setZoom] = useState(2);
  
  const {
    initializeMesh,
    clickFace,
    hoverFace,
    stats
  } = useMeshStore();

  useEffect(() => {
    initializeMesh();
  }, [initializeMesh]);

  const handleViewportChange = (newCenter: [number, number], newZoom: number) => {
    setCenter(newCenter);
    setZoom(newZoom);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="p-4 bg-white shadow-md z-10">
        <h1 className="text-2xl font-bold">STEP - Triangle Mesh Project</h1>
        <p className="text-gray-600">OpenStreetMap with triangle mesh visualization</p>
        {stats && (
          <div className="mt-2 text-sm text-gray-500">
            Faces: {stats.totalFaces} | Level: {stats.maxLevel} | Clicks: {stats.totalClicks}
          </div>
        )}
      </header>

      <main className="flex-1">
        <div className="w-full h-full" style={{ height: 'calc(100vh - 140px)' }}>
          <MapComponent
            center={center}
            zoom={zoom}
            onViewportChange={handleViewportChange}
            onFaceClick={clickFace}
            onFaceHover={hoverFace}
          />
        </div>
      </main>

      <footer className="py-3 px-4 bg-gray-100 text-center text-sm text-gray-600">
        <p>STEP - Triangle Mesh Visualization System © {new Date().getFullYear()}</p>
      </footer>
    </div>
  );
}
