'use client';

import React, { useState } from 'react';
import { MeshVisualization, MeshInteractionState } from '@/types/geometry';

interface MeshControlsProps {
  onModeChange?: (mode: MeshInteractionState['mode']) => void;
  onVisualizationChange?: (visualization: Partial<MeshVisualization>) => void;
  className?: string;
}

const MeshControls: React.FC<MeshControlsProps> = ({
  onModeChange,
  onVisualizationChange,
  className = 'fixed bottom-4 left-4 p-4 bg-white rounded-lg shadow-lg'
}) => {
  const [mode, setMode] = useState<MeshInteractionState['mode']>('VIEW');
  const [visualization, setVisualization] = useState<MeshVisualization>({
    wireframe: true,
    opacity: 0.7,
    color: '#00ff00',
    visible: true
  });

  const handleModeChange = (newMode: MeshInteractionState['mode']) => {
    setMode(newMode);
    onModeChange?.(newMode);
  };

  const handleVisualizationChange = (changes: Partial<MeshVisualization>) => {
    const newVisualization = { ...visualization, ...changes };
    setVisualization(newVisualization);
    onVisualizationChange?.(changes);
  };

  return (
    <div className={className}>
      <div className="space-y-4">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Mode</h3>
          <div className="flex space-x-2">
            {(['VIEW', 'EDIT', 'CREATE'] as const).map((m) => (
              <button
                key={m}
                onClick={() => handleModeChange(m)}
                className={`px-4 py-2 rounded ${
                  mode === m
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Visualization</h3>
          
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="wireframe"
              checked={visualization.wireframe}
              onChange={(e) => handleVisualizationChange({ wireframe: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300"
            />
            <label htmlFor="wireframe">Wireframe</label>
          </div>

          <div className="space-y-2">
            <label htmlFor="opacity" className="block">
              Opacity: {visualization.opacity}
            </label>
            <input
              type="range"
              id="opacity"
              min="0"
              max="1"
              step="0.1"
              value={visualization.opacity}
              onChange={(e) => handleVisualizationChange({ opacity: parseFloat(e.target.value) })}
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="color" className="block">
              Color
            </label>
            <input
              type="color"
              id="color"
              value={visualization.color}
              onChange={(e) => handleVisualizationChange({ color: e.target.value })}
              className="w-full h-8 rounded"
            />
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="visible"
              checked={visualization.visible}
              onChange={(e) => handleVisualizationChange({ visible: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300"
            />
            <label htmlFor="visible">Visible</label>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MeshControls;
