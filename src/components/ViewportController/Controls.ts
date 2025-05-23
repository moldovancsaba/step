import { ViewportState, ViewportAction } from '../../types/viewport';
import { clamp, normalizeAngle } from '../../utils/math';

const MIN_ZOOM = 0;
const MAX_ZOOM = 20;
const MIN_LATITUDE = -85;
const MAX_LATITUDE = 85;

export const updateViewport = (state: ViewportState, action: ViewportAction): ViewportState => {
  switch (action.type) {
    case 'PAN': {
      const [dx, dy] = action.delta;
      const scale = Math.pow(2, -state.zoom);
      
      // Calculate new center coordinates
      const newLon = state.center[0] - dx * scale;
      const newLat = clamp(
        state.center[1] + dy * scale,
        MIN_LATITUDE,
        MAX_LATITUDE
      );

      // Normalize longitude to [-180, 180]
      const normalizedLon = ((newLon + 180) % 360) - 180;

      return {
        ...state,
        center: [normalizedLon, newLat]
      };
    }

    case 'ZOOM': {
      const newZoom = clamp(
        state.zoom + Math.log2(action.factor),
        MIN_ZOOM,
        MAX_ZOOM
      );

      // Adjust center based on zoom center point
      if (action.center) {
        const scale = Math.pow(2, state.zoom - newZoom);
        const dx = (action.center[0] - state.center[0]) * (1 - scale);
        const dy = (action.center[1] - state.center[1]) * (1 - scale);

        return {
          ...state,
          zoom: newZoom,
          center: [
            state.center[0] + dx,
            clamp(state.center[1] + dy, MIN_LATITUDE, MAX_LATITUDE)
          ]
        };
      }

      return {
        ...state,
        zoom: newZoom
      };
    }

    case 'ROTATE': {
      return {
        ...state,
        rotation: normalizeAngle(state.rotation + action.angle)
      };
    }

    case 'RESET': {
      return {
        center: [0, 0],
        zoom: 0,
        rotation: 0,
        bounds: {
          min: [-180, -85],
          max: [180, 85]
        }
      };
    }

    case 'SET_BOUNDS': {
      return {
        ...state,
        bounds: action.bounds
      };
    }

    default:
      return state;
  }
};

export const isPointVisible = (
  point: [number, number],
  viewport: ViewportState
): boolean => {
  const { bounds } = viewport;
  return (
    point[0] >= bounds.min[0] &&
    point[0] <= bounds.max[0] &&
    point[1] >= bounds.min[1] &&
    point[1] <= bounds.max[1]
  );
};

export const getVisibleBounds = (viewport: ViewportState): [[number, number], [number, number]] => {
  return [
    [viewport.bounds.min[0], viewport.bounds.min[1]],
    [viewport.bounds.max[0], viewport.bounds.max[1]]
  ];
};
