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
            <h3 className="font-bold text-lg mb-2">Triangle Information</h3>
            
            {selectedFace ? (
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium">ID:</span>
                  <span className="text-gray-600">{selectedFace.id.substring(0, 8)}...</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Level:</span>
                  <span className="text-gray-600">{selectedFace.level}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Clicks:</span>
                  <span className="text-gray-600">{selectedFace.clickCount}/10</span>
                </div>
                {canSubdivideFace(selectedFace.id) && (
                  <button
                    onClick={() => subdivideFace(selectedFace.id)}
                    className="mt-2 w-full py-1 bg-blue-500 hover:bg-blue-600 text-white rounded-md text-sm transition-colors"
                  >
                    Subdivide Triangle
                  </button>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-600">
                Select a triangle on the map to view details. Click to darken, and after 10 clicks you can subdivide.
              </p>
            )}
            
            {meshStats && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <button 
                  onClick={() => setShowStats(!showStats)}
                  className="text-sm text-blue-500 hover:text-blue-700 flex items-center gap-1"
                >
                  <span>{showStats ? 'Hide' : 'Show'} Stats</span>
                  <span>{showStats ? '▲' : '▼'}</span>
                </button>
                
                {showStats && (
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span>Vertices:</span>
                      <span>{meshStats.totalVertices}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Faces:</span>
                      <span>{meshStats.totalFaces}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Max Level:</span>
                      <span>{meshStats.maxLevel}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Ready to Subdivide:</span>
                      <span>{Math.round(meshStats.subdivisionRate * 100)}%</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex gap-2">
                <button
                  onClick={resetMesh}
                  className="flex-1 py-1 bg-gray-200 hover:bg-gray-300 rounded-md text-xs transition-colors"
                  title="Reset the entire mesh to initial state"
                >
                  Reset Mesh
                </button>
                <button
                  onClick={undo}
                  disabled={!historyStatus.canUndo}
                  className={`flex-1 py-1 rounded-md text-xs transition-colors ${
                    historyStatus.canUndo 
                      ? 'bg-gray-200 hover:bg-gray-300' 
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                  title="Undo last action"
                >
                  Undo
                </button>
                <button
                  onClick={redo}
                  disabled={!historyStatus.canRedo}
                  className={`flex-1 py-1 rounded-md text-xs transition-colors ${
                    historyStatus.canRedo 
                      ? 'bg-gray-200 hover:bg-gray-300' 
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                  title="Redo last undone action"
                >
                  Redo
                </button>
              </div>
            </div>
          </div>
          
          {/* Loading Overlay for Operations */}
          {!mesh && (
            <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-20">
              <div className="bg-white p-6 rounded-lg shadow-lg text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mx-auto"></div>
                <p className="mt-4 text-lg">Loading Triangle Mesh...</p>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Footer */}
      <footer className="py-3 px-4 bg-gray-100 text-center text-sm text-gray-600">
        <p>STEP - Triangle Mesh Visualization System © {new Date().getFullYear()}</p>
      </footer>
    </div>
  );
}

/**
 * Error boundary fallback component
 */
function ErrorFallback({ error }: { error: Error }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-red-50">
      <div className="bg-white p-8 rounded-lg shadow-lg max-w-md">
        <h2 className="text-2xl font-bold text-red-600 mb-4">Something went wrong</h2>
        <p className="mb-4 text-gray-700">An error occurred while rendering the application:</p>
        <div className="bg-red-50 p-4 rounded-md mb-4 overflow-auto max-h-60">
          <p className="text-red-700 font-mono text-sm">{error.message}</p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="w-full py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors"
        >
          Reload Application
        </button>
      </div>
    </div>
  );
}
