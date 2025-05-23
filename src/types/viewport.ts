export interface ViewportState {
  center: [number, number];    // [longitude, latitude]
  zoom: number;               // Scale factor
  rotation: number;           // In degrees
  bounds: {                   // Visible area
    min: [number, number];    // [longitude, latitude]
    max: [number, number];    // [longitude, latitude]
  };
}

export interface ViewportDimensions {
  width: number;
  height: number;
  aspect: number;
}

export interface CameraConfig {
  fov: number;
  near: number;
  far: number;
  position: [number, number, number];
  target: [number, number, number];
}

export interface ViewportInteraction {
  isDragging: boolean;
  isZooming: boolean;
  isRotating: boolean;
  startPosition: [number, number] | null;
  currentPosition: [number, number] | null;
  lastDistance: number | null;  // Added for pinch-to-zoom support
}

export type ViewportAction = 
  | { type: 'PAN'; delta: [number, number] }
  | { type: 'ZOOM'; factor: number; center: [number, number] }
  | { type: 'ROTATE'; angle: number; center: [number, number] }
  | { type: 'RESET' }
  | { type: 'SET_BOUNDS'; bounds: ViewportState['bounds'] };

export interface ViewportProps {
  initialState?: Partial<ViewportState>;
  onViewportChange?: (viewport: ViewportState) => void;
  dimensions: ViewportDimensions;
}
