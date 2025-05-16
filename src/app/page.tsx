'use client';

import React from 'react';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="p-4 bg-white shadow-md z-10">
        <h1 className="text-2xl font-bold">STEP - Triangle Mesh Project</h1>
        <p className="text-gray-600">OpenStreetMap with triangle mesh visualization</p>
      </header>

      <main className="flex-1 p-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-xl font-semibold mb-4">Welcome to STEP</h2>
          <p className="text-gray-700 mb-4">
            Interactive triangle mesh visualization for OpenStreetMap with geographic subdivision capabilities.
          </p>
          <div className="p-4 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-800">
              Initial version - Triangle mesh visualization coming soon.
            </p>
          </div>
        </div>
      </main>

      <footer className="py-3 px-4 bg-gray-100 text-center text-sm text-gray-600">
        <p>STEP - Triangle Mesh Visualization System © {new Date().getFullYear()}</p>
      </footer>
    </div>
  );
}
