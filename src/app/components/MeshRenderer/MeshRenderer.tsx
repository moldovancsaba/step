'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { MeshVertex, MeshFace, MeshVisualization, Coordinate } from '@/types/geometry';
import { geoToCartesian } from '@/lib/coordinates';

interface MeshRendererProps {
  vertices: MeshVertex[];
  faces: MeshFace[];
  visualization: MeshVisualization;
  mapCenter: Coordinate;
  mapRotation: number;
  mapPitch: number;
  mapZoom: number;
  onMeshUpdate?: () => void;
}

const MeshRenderer: React.FC<MeshRendererProps> = ({
  vertices,
  faces,
  visualization,
  mapCenter,
  mapRotation,
  mapPitch,
  mapZoom,
  onMeshUpdate
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const frameIdRef = useRef<number>(0);

  // Calculate scale factor based on zoom level
  const getScaleFactor = (zoom: number) => {
    // Base scale at zoom level 0
    const baseScale = 156543.03392; // meters per pixel at zoom level 0
    return baseScale * Math.pow(2, -zoom);
  };

  // Initialize Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Scene setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      10000
    );
    camera.position.z = 1000;
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true, 
      alpha: true,
      logarithmicDepthBuffer: true
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(0, 1, 0);
    scene.add(directionalLight);

    // Handle resize
    const handleResize = () => {
      if (!container || !camera || !renderer) return;

      const width = container.clientWidth;
      const height = container.clientHeight;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      renderer.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameIdRef.current);
      
      if (renderer && container) {
        container.removeChild(renderer.domElement);
        renderer.dispose();
      }

      if (sceneRef.current) {
        sceneRef.current.clear();
      }
    };
  }, []);

  // Update camera and mesh position based on map view
  useEffect(() => {
    if (!cameraRef.current || !sceneRef.current) return;

    const camera = cameraRef.current;
    const scene = sceneRef.current;

    // Update camera position and rotation
    camera.position.set(0, 1000, 0);
    camera.lookAt(scene.position);
    
    // Apply map rotation and pitch
    scene.rotation.y = mapRotation * Math.PI / 180;
    camera.rotation.x = -mapPitch * Math.PI / 180;

    // Update animation loop
    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      if (rendererRef.current) {
        rendererRef.current.render(scene, camera);
      }
    };
    animate();

  }, [mapRotation, mapPitch]);

  // Update mesh geometry when vertices or faces change
  useEffect(() => {
    if (!sceneRef.current) return;

    // Remove existing mesh
    if (meshRef.current) {
      sceneRef.current.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      (meshRef.current.material as THREE.Material).dispose();
    }

    if (vertices.length === 0 || faces.length === 0) return;

    const scale = getScaleFactor(mapZoom);

    // Convert vertices to local coordinates
    const localVertices = vertices.map(vertex => {
      const coord: Coordinate = {
        latitude: vertex.position[1],
        longitude: vertex.position[0],
        altitude: vertex.position[2],
        timestamp: Date.now()
      };
      return geoToCartesian(coord, mapCenter, scale);
    });

    // Create geometry
    const geometry = new THREE.BufferGeometry();

    // Set vertices
    const positions = new Float32Array(localVertices.length * 3);
    localVertices.forEach((vertex, i) => {
      positions[i * 3] = vertex[0];
      positions[i * 3 + 1] = vertex[1];
      positions[i * 3 + 2] = vertex[2];
    });
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Set faces
    const indices = new Uint32Array(faces.length * 3);
    faces.forEach((face, i) => {
      indices[i * 3] = face.vertices[0];
      indices[i * 3 + 1] = face.vertices[1];
      indices[i * 3 + 2] = face.vertices[2];
    });
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    // Compute normals
    geometry.computeVertexNormals();

    // Create material
    const material = new THREE.MeshPhongMaterial({
      color: visualization.color,
      wireframe: visualization.wireframe,
      transparent: true,
      opacity: visualization.opacity,
      side: THREE.DoubleSide,
      depthWrite: true,
      depthTest: true
    });

    // Create mesh
    const mesh = new THREE.Mesh(geometry, material);
    sceneRef.current.add(mesh);
    meshRef.current = mesh;

    if (onMeshUpdate) {
      onMeshUpdate();
    }
  }, [vertices, faces, visualization, mapCenter, mapZoom, onMeshUpdate]);

  // Update visualization properties
  useEffect(() => {
    if (!meshRef.current) return;

    const material = meshRef.current.material as THREE.MeshPhongMaterial;
    material.color.set(visualization.color);
    material.wireframe = visualization.wireframe;
    material.opacity = visualization.opacity;
    material.visible = visualization.visible;
    material.needsUpdate = true;
  }, [visualization]);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full absolute inset-0 pointer-events-none"
      style={{ visibility: visualization.visible ? 'visible' : 'hidden' }}
    />
  );
};

export default MeshRenderer;
