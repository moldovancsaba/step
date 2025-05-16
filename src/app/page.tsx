'use client';

import React, { useState, useEffect } from 'react';
import { TriangleMesh } from '@/app/types/geometry';
import MapComponent from '@/app/components/Map';

// Optional: Import ErrorBoundary if it exists in your project
// import ErrorBoundary from '@/app/components/ErrorBoundary';

export default function Home() {
  // State for map view
  const [center, setCenter] = useState<[number, number]>([51.505, -0.09]);
  const [zoom, setZoom] = useState<number>(13);
  
  // State for mesh data
  const [mesh, setMesh] = useState<TriangleMesh | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [hoveredFaceId, setHoveredFaceId] = useState<string | null>(null);

  // Handle map viewport changes
  const handleViewportChange = (newCenter: [number, number], newZoom: number) => {
    setCenter(newCenter);
    setZoom(newZoom);
  };

  // Handle face interactions
  const handleFaceClick = (faceId: string) => {
    console.log(`Face clicked: ${faceId}`);
    // Implement your face click logic here
  };

  const handleFaceHover = (faceId: string | null) => {
    setHoveredFaceId(faceId);
  };

  // Load mesh data on component mount
  useEffect(() => {
    const loadMeshData = async () => {
      try {
        setIsLoading(true);
        // Example placeholder - replace with your actual data loading logic
        // const response = await fetch('/api/mesh');
        // const data = await response.json();
        
        // For now, create a simple placeholder mesh
        const placeholderMesh: TriangleMesh = {
          vertices: [
            { latitude: 51.505, longitude: -0.09 },
            { latitude: 51.51, longitude: -0.1 },
            { latitude: 51.5, longitude: -0.1 }
          ],
          faces: [
            {
              id: 'face1',
              vertices: [0, 1, 2],
              level: 0,
              clickCount: 0
            }
          ]
        };
        
        setMesh(placeholderMesh);
        setIsLoading(false);
      } catch (err) {
        console.error('Error loading mesh data:', err);
        setError(err instanceof Error ? err : new Error('Failed to load mesh data'));
        setIsLoading(false);
      }
    };

    loadMeshData();
  }, []);

  return (
    <div className="flex flex-col min-h-screen">
      <header className="py-4 px-6 bg-blue-600 text-white">
        <h1 className="text-xl font-bold">STEP - Triangle Mesh Visualization</h1>
      </header>

      <main className="flex-grow p-4">
        {error ? (
          <div className="flex items-center justify-center h-full">
            <div className="max-w-md text-center">
              <h2 className="text-xl font-bold text-red-700 mb-2">Initialization Error</h2>
              <p className="mb-4">{error.message}</p>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Retry
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full h-full relative" style={{ height: 'calc(100vh - 140px)' }}>
            <MapComponent
              center={center}
              zoom={zoom}
              onViewportChange={handleViewportChange}
              onFaceClick={handleFaceClick}
              onFaceHover={handleFaceHover}
            />
            {mesh ? (
              <div className="absolute bottom-4 right-4 bg-white p-2 rounded shadow z-50 text-xs">
                Debug: {mesh.vertices.length} vertices, {mesh.faces.length} faces
              </div>
            ) : (
              <div className="absolute bottom-4 right-4 bg-white p-2 rounded shadow z-50 text-xs">
                Debug: {isLoading ? "Loading mesh..." : "Mesh not loaded"}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="py-3 px-4 bg-gray-100 text-center text-sm text-gray-600">
        <p>STEP - Triangle Mesh Visualization System © {new Date().getFullYear()}</p>
      </footer>
    </div>
  );
}
