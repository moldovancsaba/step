'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { Scene } from './Scene';
import { MeshGeometryData, TriangleMesh } from '../../types/mesh';

interface MeshRendererProps {
  meshData: TriangleMesh[];
  selectedTriangle: string | null;
  onTriangleClick: (triangleId: string) => void;
  className?: string;
}

const MeshRenderer: React.FC<MeshRendererProps> = ({
  meshData,
  selectedTriangle,
  onTriangleClick,
  className = 'w-full h-full'
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);

  // Convert mesh data to geometry data
  const createGeometryData = useCallback((meshes: TriangleMesh[]): MeshGeometryData => {
    const vertices: number[] = [];
    const indices: number[] = [];
    let vertexIndex = 0;

    meshes.forEach(mesh => {
      // Convert each triangle's coordinates to vertices
      mesh.coordinates.forEach(coord => {
        vertices.push(coord[0], coord[1], 0);
      });

      // Add face indices
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
  }, []);

  // Handle click events for triangle selection
  const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!sceneRef.current || !containerRef.current) return;

    const triangleIndex = sceneRef.current.getIntersectedTriangle(event.clientX, event.clientY);
    if (triangleIndex >= 0 && triangleIndex < meshData.length) {
      onTriangleClick(meshData[triangleIndex].id);
    }
  }, [meshData, onTriangleClick]);

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
      sceneRef.current = null;
    };
  }, []);

  // Update mesh when data changes
  useEffect(() => {
    if (!sceneRef.current || meshData.length === 0) return;

    const geometryData = createGeometryData(meshData);
    sceneRef.current.updateMesh(geometryData);

    // Update selected triangle if any
    if (selectedTriangle) {
      const selectedIndex = meshData.findIndex(mesh => mesh.id === selectedTriangle);
      sceneRef.current.selectTriangle(selectedIndex);
    } else {
      sceneRef.current.selectTriangle(-1);
    }
  }, [meshData, selectedTriangle, createGeometryData]);

  // Animation loop
  useEffect(() => {
    let frameId: number;

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      sceneRef.current?.render();
    };

    animate();

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      onClick={handleClick}
      style={{ cursor: 'pointer' }}
    />
  );
};

export default MeshRenderer;
