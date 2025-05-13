'use client';

import { WorldMap } from './components/WorldMap/WorldMap';

export default function Home() {
  return (
    <div className="container">
      <h1 className="title">STEP - Sphere Triangular Earth Project</h1>
      <WorldMap />
      <div className="info">
        <p>This project visualizes the Earth using an icosahedron-mapped sphere.</p>
        <p>Click on triangles to change their color. After 10 clicks, triangles will subdivide.</p>
      </div>
    </div>
  );
}

