'use client';

import { useEffect, useRef, useState } from 'react';
import { generateIcosahedronVertices, generateIcosahedronFaces } from '../../../lib/geometry/icosahedron';
import { TriangleState, handleTriangleClick } from '../../../lib/interaction/clickHandler';

export function WorldMap() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('Initializing world map...');

  useEffect(() => {
    if (!canvasRef.current) return;
    
    try {
      // Initialize our world
      setMessage('Generating icosahedron geometry...');
      
      // Generate icosahedron geometry
      const vertices = generateIcosahedronVertices();
      const faces = generateIcosahedronFaces(vertices);
      
      // Create initial triangle states
      const triangleStates: TriangleState[] = faces.map((face, index) => ({
        face,
        vertices: [vertices[face.a], vertices[face.b], vertices[face.c]],
        clickCount: 0,
        level: 0,
        color: '#ffffff'
      }));
      
      setMessage(`Created ${triangleStates.length} triangles`);
      
      // In a full implementation, we would:
      // 1. Render the triangles on a map/canvas
      // 2. Set up click handlers for triangle interaction
      // 3. Implement the triangle subdivision UI
      
      // Simulate a triangle click for demonstration
      const simulatedClickResult = handleTriangleClick(triangleStates[0]);
      
      setMessage(`World map initialized. Click on triangles to interact.`);
    } catch (error) {
      console.error('Error initializing world map:', error);
      setMessage(`Error initializing world map: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, []);

  return (
    <div className="world-map-container">
      <div ref={canvasRef} className="canvas-container">
        {/* In a full implementation, this would contain a canvas or map library */}
        <div className="placeholder">
          <p>{message}</p>
          <p>Map visualization placeholder</p>
        </div>
      </div>
      
      <style jsx>{`
        .world-map-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background-color: #f5f5f5;
          border-radius: 8px;
          overflow: hidden;
          position: relative;
        }
        
        .canvas-container {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .placeholder {
          text-align: center;
          padding: 2rem;
          background-color: rgba(200, 200, 200, 0.3);
          border-radius: 8px;
        }
      `}</style>
    </div>
  );
}

