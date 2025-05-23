'use client';

import React, { useCallback, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { MeshVertex, MeshFace, Coordinate, MeshInteractionState } from '@/types/geometry';

interface MeshInteractionManagerProps {
  map: mapboxgl.Map;
  mode: MeshInteractionState['mode'];
  onVerticesChange: (vertices: MeshVertex[]) => void;
  onFacesChange: (faces: MeshFace[] | ((prev: MeshFace[]) => MeshFace[])) => void;
  initialVertices?: MeshVertex[];
  initialFaces?: MeshFace[];
}

const MeshInteractionManager: React.FC<MeshInteractionManagerProps> = ({
  map,
  mode,
  onVerticesChange,
  onFacesChange,
  initialVertices = [],
  initialFaces = []
}) => {
  const [vertices, setVertices] = useState<MeshVertex[]>(initialVertices);
  const [selectedVertices, setSelectedVertices] = useState<number[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedVertex, setDraggedVertex] = useState<number | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Initialize faces with initialFaces
  useEffect(() => {
    if (initialFaces.length > 0) {
      onFacesChange(initialFaces);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Create faces when we have three selected vertices
  const createFace = useCallback((indices: number[]) => {
    if (indices.length !== 3) return;

    const newFace: MeshFace = {
      vertices: [indices[0], indices[1], indices[2]]
    };

    onFacesChange(prevFaces => [...prevFaces, newFace]);
  }, [onFacesChange]);

  // Convert map coordinates to mesh vertex
  const coordinateToVertex = useCallback((coord: Coordinate): MeshVertex => {
    return {
      position: [coord.longitude, coord.latitude, coord.altitude || 0]
    };
  }, []);

  // Handle map click for vertex creation
  const handleMapClick = useCallback((e: mapboxgl.MapMouseEvent) => {
    if (mode !== 'CREATE' || !isDrawing) return;

    const newVertex: MeshVertex = coordinateToVertex({
      longitude: e.lngLat.lng,
      latitude: e.lngLat.lat,
      altitude: 0,
      timestamp: Date.now()
    });

    setVertices(prev => {
      const newVertices = [...prev, newVertex];
      onVerticesChange(newVertices);
      return newVertices;
    });

    // If we have 3 vertices, create a face
    setSelectedVertices(prev => {
      const newSelected = [...prev, vertices.length];
      if (newSelected.length === 3) {
        createFace(newSelected);
        return [];
      }
      return newSelected;
    });
  }, [mode, isDrawing, vertices.length, coordinateToVertex, onVerticesChange, createFace]);

  // Mouse move handler for vertex dragging
  const handleMouseMove = useCallback((e: mapboxgl.MapMouseEvent) => {
    if (!isDragging || draggedVertex === null || mode !== 'EDIT') return;

    const newVertex = coordinateToVertex({
      longitude: e.lngLat.lng,
      latitude: e.lngLat.lat,
      altitude: vertices[draggedVertex].position[2],
      timestamp: Date.now()
    });

    setVertices(prev => {
      const newVertices = [...prev];
      newVertices[draggedVertex] = newVertex;
      onVerticesChange(newVertices);
      return newVertices;
    });
  }, [isDragging, draggedVertex, mode, vertices, coordinateToVertex, onVerticesChange]);

  // Handle vertex selection and drag start
  const handleVertexClick = useCallback((index: number, originalEvent: MouseEvent) => {
    // Stop the event from triggering the map click
    originalEvent.preventDefault();
    originalEvent.stopPropagation();

    if (mode === 'EDIT') {
      setSelectedVertices(prev => {
        const isSelected = prev.includes(index);
        return isSelected ? prev.filter(i => i !== index) : [...prev, index];
      });
      setDraggedVertex(index);
      setIsDragging(true);
    }
  }, [mode]);

  // Handle mouse up to end dragging
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDraggedVertex(null);
  }, []);

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedVertices([]);
        setIsDrawing(false);
        setIsDragging(false);
        setDraggedVertex(null);
      } else if (e.key === 'Delete' && mode === 'EDIT') {
        const verticesToRemove = new Set(selectedVertices);
        setVertices(prev => {
          const newVertices = prev.filter((_, i) => !verticesToRemove.has(i));
          onVerticesChange(newVertices);
          return newVertices;
        });
        onFacesChange(prevFaces => 
          prevFaces.filter(face => !face.vertices.some(v => verticesToRemove.has(v)))
        );
        setSelectedVertices([]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, selectedVertices, onVerticesChange, onFacesChange]);

  // Add map event listeners
  useEffect(() => {
    if (!map) return;

    map.on('click', handleMapClick);
    map.on('mousemove', handleMouseMove);
    map.on('mouseup', handleMouseUp);
    map.getCanvas().style.cursor = mode === 'CREATE' ? 'crosshair' : 'pointer';

    return () => {
      map.off('click', handleMapClick);
      map.off('mousemove', handleMouseMove);
      map.off('mouseup', handleMouseUp);
      map.getCanvas().style.cursor = '';
    };
  }, [map, handleMapClick, handleMouseMove, handleMouseUp, mode]);

  // Update drawing state based on mode
  useEffect(() => {
    if (mode !== 'CREATE') {
      setIsDrawing(false);
      setSelectedVertices([]);
    } else {
      setIsDrawing(true);
    }
  }, [mode]);

  // Render vertex markers
  useEffect(() => {
    const markers: mapboxgl.Marker[] = [];

    vertices.forEach((vertex, index) => {
      const marker = document.createElement('div');
      marker.className = `w-3 h-3 rounded-full border-2 ${
        selectedVertices.includes(index) ? 'bg-blue-500 border-white' : 'bg-gray-500 border-gray-300'
      }`;
      marker.style.cursor = mode === 'EDIT' ? 'move' : 'pointer';

      const markerInstance = new mapboxgl.Marker(marker)
        .setLngLat([vertex.position[0], vertex.position[1]])
        .addTo(map);

      marker.addEventListener('click', (e: MouseEvent) => {
        handleVertexClick(index, e);
      });

      markers.push(markerInstance);
    });

    return () => {
      markers.forEach(marker => marker.remove());
    };
  }, [vertices, selectedVertices, mode, map, handleVertexClick]);

  return null;
};

export default MeshInteractionManager;
