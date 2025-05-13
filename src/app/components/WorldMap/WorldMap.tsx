'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
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
      <ThreeWorldMap />
    </div>
  );
}
