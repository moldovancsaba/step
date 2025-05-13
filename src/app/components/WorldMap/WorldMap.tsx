'use client';

import dynamic from 'next/dynamic';
import { ErrorBoundary } from '../ErrorBoundary';
import styles from './WorldMap.module.css';

// Dynamically import Three.js components to avoid SSR issues
const ThreeWorldMap = dynamic(
  () => import('./ThreeWorldMap').then((mod) => mod.ThreeWorldMap),
  {
    ssr: false,
    loading: () => (
      <div className={styles.loading}>Loading 3D visualization...</div>
    ),
  }
);

export function WorldMap() {
  return (
    <div className={styles.worldMap}>
      <ErrorBoundary
        fallback={
          <div className={styles.error}>
            <h3>Error loading 3D visualization</h3>
            <p>Please refresh the page to try again.</p>
          </div>
        }
      >
        <ThreeWorldMap />
      </ErrorBoundary>
    </div>
  );
}
