'use client';

import dynamic from 'next/dynamic';
import { MapComponentProps } from './types';

// Dynamically import the MapComponent with no SSR
const DynamicMap = dynamic(() => import('./index'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gray-900 mb-4"></div>
        <p>Loading map...</p>
      </div>
    </div>
  )
});

// Forward the props
const MapWrapper = (props: MapComponentProps) => <DynamicMap {...props} />;

export default MapWrapper;

