'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ViewportState, ViewportProps, ViewportInteraction } from '../../types/viewport';
import { updateViewport } from './Controls';
import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut, MoveHorizontal } from 'lucide-react';

const ViewportController: React.FC<ViewportProps> = ({
  initialState,
  onViewportChange,
  dimensions
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialZoomApplied = useRef(false);
  const [viewport, setViewport] = useState<ViewportState>(() => ({
    center: initialState?.center || [0, 0],
    zoom: initialState?.zoom || 0,
    rotation: initialState?.rotation || 0,
    bounds: initialState?.bounds || {
      min: [-180, -85],
      max: [180, 85]
    }
  }));

  const [interaction, setInteraction] = useState<ViewportInteraction>({
    isDragging: false,
    isZooming: false,
    isRotating: false,
    startPosition: null,
    currentPosition: null,
    lastDistance: null
  });

  // Handle viewport updates
  const handleViewportUpdate = useCallback((newViewport: ViewportState) => {
    setViewport(newViewport);
    onViewportChange?.(newViewport);
  }, [onViewportChange]);

  // Calculate initial zoom to fit mesh
  useEffect(() => {
    if (!initialZoomApplied.current && viewport.bounds) {
      const lonSpan = Math.abs(viewport.bounds.max[0] - viewport.bounds.min[0]);
      const latSpan = Math.abs(viewport.bounds.max[1] - viewport.bounds.min[1]);
      const zoomX = Math.log2(dimensions.width / lonSpan);
      const zoomY = Math.log2(dimensions.height / latSpan);
      const zoom = Math.min(zoomX, zoomY) - 1; // Subtract 1 to add some padding

      handleViewportUpdate({
        ...viewport,
        zoom: zoom,
        center: [
          (viewport.bounds.min[0] + viewport.bounds.max[0]) / 2,
          (viewport.bounds.min[1] + viewport.bounds.max[1]) / 2
        ]
      });
      initialZoomApplied.current = true;
    }
  }, [dimensions.width, dimensions.height, viewport.bounds, viewport, handleViewportUpdate]);

  // Handle gesture start
  const handleStart = useCallback((event: React.TouchEvent | React.MouseEvent) => {
    if (!containerRef.current) return;
    
    event.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    
    if ('touches' in event) {
      if (event.touches.length === 2) {
        // Two-finger gesture start
        const touch1 = event.touches[0];
        const touch2 = event.touches[1];
        const distance = Math.hypot(
          touch2.clientX - touch1.clientX,
          touch2.clientY - touch1.clientY
        );
        
        setInteraction(prev => ({
          ...prev,
          isZooming: true,
          lastDistance: distance
        }));
      } else {
        // Single-finger pan start
        const touch = event.touches[0];
        setInteraction(prev => ({
          ...prev,
          isDragging: true,
          startPosition: [
            touch.clientX - rect.left,
            touch.clientY - rect.top
          ],
          currentPosition: [
            touch.clientX - rect.left,
            touch.clientY - rect.top
          ]
        }));
      }
    } else {
      setInteraction(prev => ({
        ...prev,
        isDragging: true,
        startPosition: [
          (event as React.MouseEvent).clientX - rect.left,
          (event as React.MouseEvent).clientY - rect.top
        ],
        currentPosition: [
          (event as React.MouseEvent).clientX - rect.left,
          (event as React.MouseEvent).clientY - rect.top
        ]
      }));
    }
  }, []);

  // Handle gesture move
  const handleMove = useCallback((event: React.TouchEvent | React.MouseEvent) => {
    if (!containerRef.current) return;
    
    event.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();

    if ('touches' in event) {
      if (event.touches.length === 2 && interaction.isZooming) {
        // Handle pinch zoom
        const touch1 = event.touches[0];
        const touch2 = event.touches[1];
        const distance = Math.hypot(
          touch2.clientX - touch1.clientX,
          touch2.clientY - touch1.clientY
        );
        
        if (interaction.lastDistance) {
          const factor = distance / interaction.lastDistance;
          handleViewportUpdate(
            updateViewport(viewport, {
              type: 'ZOOM',
              factor,
              center: [dimensions.width / 2, dimensions.height / 2]
            })
          );
        }
        
        setInteraction(prev => ({
          ...prev,
          lastDistance: distance
        }));
      } else if (interaction.isDragging) {
        // Handle single finger pan
        const touch = event.touches[0];
        const position: [number, number] = [
          touch.clientX - rect.left,
          touch.clientY - rect.top
        ];
        
        if (interaction.startPosition) {
          const dx = position[0] - interaction.startPosition[0];
          const dy = position[1] - interaction.startPosition[1];
          
          handleViewportUpdate(
            updateViewport(viewport, {
              type: 'PAN',
              delta: [dx, dy]
            })
          );
        }
        
        setInteraction(prev => ({
          ...prev,
          startPosition: position
        }));
      }
    } else if (interaction.isDragging) {
      // Handle mouse drag
      const position: [number, number] = [
        (event as React.MouseEvent).clientX - rect.left,
        (event as React.MouseEvent).clientY - rect.top
      ];
      
      if (interaction.startPosition) {
        const dx = position[0] - interaction.startPosition[0];
        const dy = position[1] - interaction.startPosition[1];
        
        handleViewportUpdate(
          updateViewport(viewport, {
            type: 'PAN',
            delta: [dx, dy]
          })
        );
      }
      
      setInteraction(prev => ({
        ...prev,
        startPosition: position
      }));
    }
  }, [interaction, viewport, dimensions, handleViewportUpdate]);

  // Handle gesture end
  const handleEnd = useCallback(() => {
    setInteraction(prev => ({
      ...prev,
      isDragging: false,
      isZooming: false,
      startPosition: null,
      currentPosition: null,
      lastDistance: null
    }));
  }, []);

  // Handle zoom buttons
  const handleZoom = useCallback((factor: number) => {
    handleViewportUpdate(
      updateViewport(viewport, {
        type: 'ZOOM',
        factor,
        center: [dimensions.width / 2, dimensions.height / 2]
      })
    );
  }, [viewport, dimensions, handleViewportUpdate]);

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const ZOOM_FACTOR = 1.2;
      const PAN_AMOUNT = 50;

      switch (event.key) {
        case '=':
        case '+':
          handleZoom(ZOOM_FACTOR);
          break;
        case '-':
        case '_':
          handleZoom(1 / ZOOM_FACTOR);
          break;
        case 'ArrowLeft':
          handleViewportUpdate(
            updateViewport(viewport, { type: 'PAN', delta: [PAN_AMOUNT, 0] })
          );
          break;
        case 'ArrowRight':
          handleViewportUpdate(
            updateViewport(viewport, { type: 'PAN', delta: [-PAN_AMOUNT, 0] })
          );
          break;
        case 'ArrowUp':
          handleViewportUpdate(
            updateViewport(viewport, { type: 'PAN', delta: [0, PAN_AMOUNT] })
          );
          break;
        case 'ArrowDown':
          handleViewportUpdate(
            updateViewport(viewport, { type: 'PAN', delta: [0, -PAN_AMOUNT] })
          );
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewport, handleViewportUpdate, handleZoom]);

  return (
    <>
      <div
        ref={containerRef}
        className="relative touch-none"
        onMouseDown={handleStart}
        onMouseMove={handleMove}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
        style={{
          cursor: interaction.isDragging ? 'grabbing' : 'grab',
          width: dimensions.width,
          height: dimensions.height
        }}
      />

      {/* Zoom Controls */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 flex flex-col gap-2">
        <Button
          variant="secondary"
          size="lg"
          onClick={() => handleZoom(1.2)}
          className="bg-white/80 backdrop-blur-sm hover:bg-white/90 h-12 w-12"
        >
          <ZoomIn className="h-6 w-6" />
        </Button>
        <Button
          variant="secondary"
          size="lg"
          onClick={() => handleZoom(1/1.2)}
          className="bg-white/80 backdrop-blur-sm hover:bg-white/90 h-12 w-12"
        >
          <ZoomOut className="h-6 w-6" />
        </Button>
      </div>

      {/* Reset Control */}
      <div className="absolute right-4 bottom-20 flex items-center gap-2">
        <Button
          variant="secondary"
          size="lg"
          className="bg-white/80 backdrop-blur-sm hover:bg-white/90"
          onClick={() => handleViewportUpdate(updateViewport(viewport, { type: 'RESET' }))}
        >
          <MoveHorizontal className="h-4 w-4 mr-2" />
          Reset View
        </Button>
      </div>
    </>
  );
};

export default ViewportController;
