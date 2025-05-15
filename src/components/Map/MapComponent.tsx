'use client';

import { useEffect, useState, Component, PropsWithChildren, ErrorInfo } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import TriangleLayer from './TriangleLayer';

/**
 * Error Boundary component to catch and handle runtime errors in the map component
 * without crashing the entire application.
 */
class ErrorBoundary extends Component<
  PropsWithChildren<{ fallback?: React.ReactNode }>,
  { hasError: boolean; error: Error | null }
> {
  constructor(props: PropsWithChildren<{ fallback?: React.ReactNode }>) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Map component error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex flex-col items-center justify-center h-screen w-full bg-gray-50 p-4">
            <h2 className="text-red-600 text-xl font-semibold mb-2">
              Map failed to load
            </h2>
            <p className="text-gray-700 mb-4">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Try again
            </button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

/**
 * MapComponent props interface
 */
interface MapComponentProps {
  /** Initial map center coordinates [lat, lng] */
  center?: [number, number];
  /** Initial zoom level */
  zoom?: number;
  /** Whether scroll wheel zoom is enabled */
  scrollWheelZoom?: boolean;
  /** Additional className for the container */
  className?: string;
}

/**
 * MapComponent displays an interactive OpenStreetMap using Leaflet
 * with a layer of triangles representing an icosahedron projection.
 */
const MapComponent: React.FC<MapComponentProps> = ({
  center = [0, 0],
  zoom = 2,
  scrollWheelZoom = true,
  className = '',
}) => {
  // Track when the map is ready
  const [mapReady, setMapReady] = useState<boolean>(false);
  // Track loading state
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    // Workaround for Leaflet marker icons with Next.js
    // This is only needed for Leaflet markers
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
    });

    // Set loading to false after the effect runs
    setIsLoading(false);
  }, []);

  // Handle map ready event
  const handleMapReady = () => {
    setMapReady(true);
    setIsLoading(false);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-screen w-full">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
    </div>;
  }

  return (
    <ErrorBoundary>
      <div className={`h-screen w-full ${className}`}>
        <MapContainer
          center={center}
          zoom={zoom}
          scrollWheelZoom={scrollWheelZoom}
          className="h-full w-full"
          whenReady={handleMapReady}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {mapReady && <TriangleLayer />}
        </MapContainer>
      </div>
    </ErrorBoundary>
  );
};

export default MapComponent;
