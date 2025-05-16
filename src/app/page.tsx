'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useTriangleMesh } from './hooks/useTriangleMesh';
import Triangle from './components/Triangle';
import { ScreenCoordinate, MapProjection } from './types/geometry';

export default function Home() {
  const { 
    mesh, 
    meshStats, 
    selectedFace,
    selectedFaceId,
    hoveredFace,
    hoveredFaceId,
    mapProjection,
    historyStatus,
    
    initializeMesh,
    resetMesh,
    selectFace,
    hoverFace,
    clickFace,
    subdivideFace,
    canSubdivideFace,
    
    zoomIn,
    zoomOut,
    panMap,
    updateMapSize,
    centerMapOn,
    setZoom,
    
    undo,
    redo,
    
    getFacesByLevel
  } = useTriangleMesh();

  // Ref for the map container
  const mapContainerRef = useRef<HTMLDivElement>(null);
  
  // State for handling map interactions
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<ScreenCoordinate | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [showStats, setShowStats] = useState(false);

  // Update map size on window resize
  useEffect(() => {
    const handleResize = () => {
      if (mapContainerRef.current) {
        updateMapSize(
          mapContainerRef.current.clientWidth,
          mapContainerRef.current.clientHeight
        );
      }
    };
    
    // Set initial size
    handleResize();
    
    // Listen for resize events
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateMapSize]);
  
  // Handle mouse down for map dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  }, []);
  
  // Handle mouse move for map dragging
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && dragStart) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      
      // Convert pixel movement to geographic coordinates
      // The factor adjusts sensitivity based on zoom level
      const factor = 0.01 / Math.pow(2, mapProjection.zoom - 1);
      
      panMap(-dy * factor, dx * factor);
      setDragStart({ x: e.clientX, y: e.clientY });
    }
  }, [isDragging, dragStart, panMap, mapProjection.zoom]);
  
  // Handle mouse up to end dragging
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragStart(null);
  }, []);
  
  // Handle mouse wheel for zooming
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.deltaY < 0) {
      zoomIn();
    } else {
      zoomOut();
    }
    e.preventDefault();
  }, [zoomIn, zoomOut]);
  
  // Handle triangle click
  const handleTriangleClick = useCallback((faceId: string, event: React.MouseEvent) => {
    clickFace(faceId, event);
  }, [clickFace]);
  
  // Show loading state if mesh is not yet available
  if (!mesh) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Loading Triangle Mesh...</h2>
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gray-900 mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="p-4 bg-white shadow-md z-10">
        <h1 className="text-2xl font-bold">STEP - Triangle Mesh Triangular Earth Project</h1>
        <p className="text-gray-600">OpenStreetMap overlay with interactive triangle subdivision</p>
      </header>

      <div className="flex flex-1 relative">
        {/* OpenStreetMap Container */}
        <div 
          ref={mapContainerRef}
          className="w-full h-full relative overflow-hidden"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          {/* Map Layer - Using an iframe for OpenStreetMap */}
          <iframe 
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${mapProjection.center.longitude - 10},${mapProjection.center.latitude - 10},${mapProjection.center.longitude + 10},${mapProjection.center.latitude + 10}&layer=mapnik&marker=${mapProjection.center.latitude},${mapProjection.center.longitude}`}
            className="absolute inset-0 w-full h-full"
            style={{ pointerEvents: 'none' }} // Prevent iframe from capturing events
          />
          
          {/* SVG Overlay for Triangles */}
          <svg 
            className="absolute inset-0 w-full h-full"
            viewBox={`0 0 ${mapProjection.width} ${mapProjection.height}`}
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Render all triangles */}
            {mesh.faces.map(face => (
              <Triangle
                key={face.id}
                face={face}
                mesh={mesh}
                projection={mapProjection}
                isSelected={face.id === selectedFaceId}
                canSubdivide={canSubdivideFace(face.id)}
                onTriangleClick={handleTriangleClick}
                onTriangleHover={hoverFace}
                onSubdivide={subdivideFace}
              />
            ))}
          </svg>
          
          {/* Map Controls */}
          {showControls && (
            <div className="absolute top-4 right-4 bg-white p-2 rounded-md shadow-md space-y-2">
              <button 
                onClick={zoomIn}
                className="w-10 h-10 bg-gray-100 hover:bg-gray-200 flex items-center justify-center rounded-md"
                title="Zoom In"
              >
                <span className="text-xl">+</span>
              </button>
              <button 
                onClick={zoomOut}
                className="w-10 h-10 bg-gray-100 hover:bg-gray-200 flex items-center justify-center rounded-md"
                title="Zoom Out"
              >
                <span className="text-xl">-</span>
              </button>
              <button 
                onClick={() => centerMapOn({ latitude: 0, longitude: 0 })}
                className="w-10 h-10 bg-gray-100 hover:bg-gray-200 flex items-center justify-center rounded-md"
                title="Reset View"
              >
                <span className="text-sm">🌎</span>
              </button>
            </div>
          )}
          
          {/* Info Panel */}
          <div className="absolute bottom-4 left-4 bg-white p-4 rounded-md shadow-md max-w-xs">
            <h3 className="font-bold text-
