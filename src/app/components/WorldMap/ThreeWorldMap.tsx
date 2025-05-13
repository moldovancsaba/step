'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { generateIcosahedronVertices, generateIcosahedronFaces } from '@/lib/geometry/icosahedron';
import { handleTriangleClick, TriangleState, ClickResult } from '@/lib/interaction/clickHandler';
import styles from './WorldMap.module.css';

// Add type guard for newTriangles
function hasNewTriangles(result: ClickResult): result is ClickResult & { newTriangles: TriangleState[] } {
  return result.subdivided === true && Array.isArray(result.newTriangles);
}

export function ThreeWorldMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [triangleStates, setTriangleStates] = useState<TriangleState[]>([]);

  // Step 1: Initialize state data
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const vertices = generateIcosahedronVertices();
    const faces = generateIcosahedronFaces(vertices);

    // Initialize triangle states
    const initialStates = faces.map((face, index) => ({
      face,
      vertices: [vertices[face.a], vertices[face.b], vertices[face.c]],
      clickCount: 0,
      level: 0,
      color: '#ffffff'
    }));
    
    setTriangleStates(initialStates);
    setIsInitialized(true);
  }, []);

  // Step 2: Set up Three.js scene after state is initialized
  useEffect(() => {
    if (!containerRef.current || !isInitialized || typeof window === 'undefined' || triangleStates.length === 0) return;

    // Setup Three.js
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color('#000000');

    const camera = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    cameraRef.current = camera;
    camera.position.z = 2;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    rendererRef.current = renderer;
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    containerRef.current.appendChild(renderer.domElement);

    // Add orbit controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableZoom = true;
    controls.enablePan = false;

    // Create triangles from state
    triangleStates.forEach((state, index) => {
      const triangleGeometry = new THREE.BufferGeometry();
      const triangleVertices = new Float32Array([
        state.vertices[0].x, state.vertices[0].y, state.vertices[0].z,
        state.vertices[1].x, state.vertices[1].y, state.vertices[1].z,
        state.vertices[2].x, state.vertices[2].y, state.vertices[2].z
      ]);
      triangleGeometry.setAttribute('position', new THREE.BufferAttribute(triangleVertices, 3));
      triangleGeometry.computeVertexNormals();
      
      const material = new THREE.MeshPhongMaterial({
        color: state.color,
        side: THREE.DoubleSide,
        wireframe: false,
        transparent: true,
        opacity: 0.8
      });
      
      const mesh = new THREE.Mesh(triangleGeometry, material);
      mesh.userData.faceIndex = index;
      scene.add(mesh);
    });

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current || !renderer || !camera) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    // Handle clicks
    const handleClick = (event: MouseEvent) => {
      if (!scene || !camera) return;
      
      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

      const intersects = raycaster.intersectObjects(scene.children);
      if (intersects.length > 0) {
        const mesh = intersects[0].object as THREE.Mesh;
        if (mesh.userData.faceIndex === undefined) return;

        const faceIndex = mesh.userData.faceIndex;
        const state = triangleStates[faceIndex];
        if (!state) return;
        
        const result = handleTriangleClick(state);
        if (hasNewTriangles(result)) {
          // Remove old triangle
          scene.remove(mesh);
          
          // Add new subdivided triangles
          result.newTriangles.forEach((newState, i) => {
            const newGeometry = new THREE.BufferGeometry();
            const newVertices = new Float32Array([
              newState.vertices[0].x, newState.vertices[0].y, newState.vertices[0].z,
              newState.vertices[1].x, newState.vertices[1].y, newState.vertices[1].z,
              newState.vertices[2].x, newState.vertices[2].y, newState.vertices[2].z
            ]);
            newGeometry.setAttribute('position', new THREE.BufferAttribute(newVertices, 3));
            newGeometry.computeVertexNormals();
            
            const newMaterial = new THREE.MeshPhongMaterial({
              color: newState.color,
              side: THREE.DoubleSide,
              wireframe: false,
              transparent: true,
              opacity: 0.8
            });
            
            const newMesh = new THREE.Mesh(newGeometry, newMaterial);
            newMesh.userData.faceIndex = faceIndex + i;
            scene.add(newMesh);
          });

          setTriangleStates(prev => {
            const next = [...prev];
            next.splice(faceIndex, 1, ...result.newTriangles);
            return next;
          });
        } else {
          // Just update color
          const material = mesh.material as THREE.MeshPhongMaterial;
          material.color.set(result.color);
          setTriangleStates(prev => {
            const next = [...prev];
            next[faceIndex] = { ...state, color: result.color, clickCount: result.clickCount };
            return next;
          });
        }
      }
    };
    renderer.domElement.addEventListener('click', handleClick);

    // Animation loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('click', handleClick);
      renderer.dispose();
      controls.dispose();
      scene.clear();
      if (containerRef.current?.contains(renderer.domElement)) {
        containerRef.current.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, [isInitialized, triangleStates]);

  if (!isInitialized) {
    return <div className={styles.loading}>Initializing 3D visualization...</div>;
  }

  return <div ref={containerRef} className={styles.container} />;
}

