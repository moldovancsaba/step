'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { generateIcosahedronVertices, generateIcosahedronFaces } from '@/lib/geometry/icosahedron';
import { handleTriangleClick, TriangleState } from '@/lib/interaction/clickHandler';
import styles from './WorldMap.module.css';

export function WorldMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [triangleStates, setTriangleStates] = useState<TriangleState[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize base geometry
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

    // Setup Three.js
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    containerRef.current.appendChild(renderer.domElement);

    // Setup camera position
    camera.position.z = 2;

    // Add orbit controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Create icosahedron geometry
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(vertices.length * 3);
    vertices.forEach((vertex, i) => {
      positions[i * 3] = vertex.x;
      positions[i * 3 + 1] = vertex.y;
      positions[i * 3 + 2] = vertex.z;
    });
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Create faces
    faces.forEach((face, index) => {
      const triangleGeometry = new THREE.BufferGeometry();
      const triangleVertices = new Float32Array([
        vertices[face.a].x, vertices[face.a].y, vertices[face.a].z,
        vertices[face.b].x, vertices[face.b].y, vertices[face.b].z,
        vertices[face.c].x, vertices[face.c].y, vertices[face.c].z
      ]);
      triangleGeometry.setAttribute('position', new THREE.BufferAttribute(triangleVertices, 3));
      
      const material = new THREE.MeshBasicMaterial({
        color: triangleStates[index].color,
        side: THREE.DoubleSide,
        wireframe: true
      });
      
      const mesh = new THREE.Mesh(triangleGeometry, material);
      mesh.userData.faceIndex = index;
      scene.add(mesh);
    });

    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    // Handle clicks
    const handleClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

      const intersects = raycaster.intersectObjects(scene.children);
      if (intersects.length > 0) {
        const mesh = intersects[0].object as THREE.Mesh;
        const faceIndex = mesh.userData.faceIndex;
        const state = triangleStates[faceIndex];
        
        const result = handleTriangleClick(state);
        if (result.subdivided && result.newTriangles) {
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
            
            const newMaterial = new THREE.MeshBasicMaterial({
              color: newState.color,
              side: THREE.DoubleSide,
              wireframe: true
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
          (mesh.material as THREE.MeshBasicMaterial).color.set(result.color);
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
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('click', handleClick);
      renderer.dispose();
      controls.dispose();
      if (containerRef.current?.contains(renderer.domElement)) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div ref={containerRef} className={styles.worldMap}>
      <div className={styles.loading}>Loading...</div>
    </div>
  );
}

