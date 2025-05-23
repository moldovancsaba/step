'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Scene } from '@/components/MeshRenderer/Scene';
import { TriangleMesh } from '@/types/mesh';

const createGeometryData = (meshes: TriangleMesh[]) => {
  const vertices: number[] = [];
  const indices: number[] = [];
  let vertexIndex = 0;

  meshes.forEach(mesh => {
    mesh.coordinates.forEach(coord => {
      vertices.push(coord[0], coord[1], 0);
    });

    indices.push(
      vertexIndex,
      vertexIndex + 1,
      vertexIndex + 2
    );
    vertexIndex += 3;
  });

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices)
  };
};

export default function Home() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [selectedTriangleId, setSelectedTriangleId] = useState<string | null>(null);
  const [meshData, setMeshData] = useState<TriangleMesh[]>([]);
  const [userLocation, setUserLocation] = useState<GeolocationCoordinates | null>(null);
  const watchIdRef = useRef<number | null>(null);

  // Load mesh data
  useEffect(() => {
    fetch('/triangle_base_coordinates_22.json')
      .then(response => response.json())
      .then(data => {
        setMeshData(data);
      })
      .catch(error => {
        console.error('Error loading mesh data:', error);
      });
  }, []);

  // Watch user location
  useEffect(() => {
    if ('geolocation' in navigator) {
      // Get initial position
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation(position.coords);
        },
        (error) => {
          console.error('Error getting location:', error);
        }
      );

      // Watch position changes
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          setUserLocation(position.coords);
        },
        (error) => {
          console.error('Error watching location:', error);
        },
        {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0
        }
      );
    }

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  // Initialize scene
  useEffect(() => {
    if (!containerRef.current) return;

    sceneRef.current = new Scene(containerRef.current);

    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current || !sceneRef.current) return;
      sceneRef.current.setSize(
        containerRef.current.clientWidth,
        containerRef.current.clientHeight
      );
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      sceneRef.current?.dispose();
    };
  }, []);

  // Update mesh when data is loaded
  useEffect(() => {
    if (!sceneRef.current || meshData.length === 0) return;
    const geometryData = createGeometryData(meshData);
    sceneRef.current.updateMesh(geometryData);
  }, [meshData]);

  // Update user location marker
  useEffect(() => {
    if (!sceneRef.current || !userLocation) return;
    sceneRef.current.updateUserLocation(userLocation.longitude, userLocation.latitude);
  }, [userLocation]);

  // Handle mesh clicks
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!sceneRef.current || !meshData.length) return;

    const triangleIndex = sceneRef.current.getIntersectedTriangle(event.clientX, event.clientY);
    if (triangleIndex >= 0) {
      const triangleId = meshData[triangleIndex].id;
      setSelectedTriangleId(triangleId);
      sceneRef.current.selectTriangle(triangleIndex);
    }
  };

  // Animation loop
  useEffect(() => {
    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      sceneRef.current?.render();
    };
    animate();
    return () => cancelAnimationFrame(frameId);
  }, []);

  return (
    <div className="h-screen w-screen">
      {/* Mesh Container */}
      <div
        ref={containerRef}
        className="w-full h-full bg-neutral-100"
        onClick={handleClick}
        style={{ cursor: 'pointer' }}
      />

      {/* Info Overlay */}
      <div className="absolute bottom-4 left-4 bg-white/80 backdrop-blur-sm rounded-lg p-4 text-sm space-y-2">
        {selectedTriangleId && (
          <p className="font-medium">Selected Triangle: {selectedTriangleId}</p>
        )}
        {userLocation && (
          <div>
            <p className="font-medium">Your Location:</p>
            <p>Latitude: {userLocation.latitude.toFixed(6)}°</p>
            <p>Longitude: {userLocation.longitude.toFixed(6)}°</p>
            {userLocation.altitude && (
              <p>Altitude: {userLocation.altitude.toFixed(1)}m</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
