import * as THREE from 'three';
import { MeshGeometryData } from '../../types/mesh';

export class Scene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private raycaster: THREE.Raycaster;
  private mesh: THREE.Group | null = null;
  private triangles: THREE.LineSegments[] = [];
  private selectedTriangleIndex: number = -1;
  private userLocation: THREE.Mesh | null = null;

  constructor(container: HTMLElement) {
    // Initialize scene with light grey background
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf5f5f5);
    
    // Initialize camera
    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 10000);
    this.camera.position.set(0, 0, 500);
    this.camera.lookAt(0, 0, 0);

    // Initialize renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    // Initialize raycaster for triangle selection
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line = {
      threshold: 2 // Increase threshold for easier selection
    };
  }

  public updateMesh(geometryData: MeshGeometryData): void {
    // Remove existing mesh if it exists
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.triangles.forEach(triangle => {
        triangle.geometry.dispose();
        (triangle.material as THREE.Material).dispose();
      });
      this.triangles = [];
    }

    // Create a group to hold all triangles
    this.mesh = new THREE.Group();

    // Calculate scale factor to fit mesh in view
    const vertices = geometryData.vertices;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < vertices.length; i += 3) {
      minX = Math.min(minX, vertices[i]);
      maxX = Math.max(maxX, vertices[i]);
      minY = Math.min(minY, vertices[i + 1]);
      maxY = Math.max(maxY, vertices[i + 1]);
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const scale = Math.min(800 / width, 800 / height);

    // Create individual triangles as line segments
    for (let i = 0; i < geometryData.indices.length; i += 3) {
      const triangleVertices = [];
      for (let j = 0; j < 3; j++) {
        const idx = geometryData.indices[i + j] * 3;
        triangleVertices.push(
          (geometryData.vertices[idx] - (maxX + minX) / 2) * scale,
          (geometryData.vertices[idx + 1] - (maxY + minY) / 2) * scale,
          0
        );
      }
      // Add closing vertex to complete the triangle
      triangleVertices.push(triangleVertices[0], triangleVertices[1], triangleVertices[2]);

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(triangleVertices, 3));

      const material = new THREE.LineBasicMaterial({
        color: 0x000000,
        linewidth: 1
      });
      const triangle = new THREE.LineSegments(geometry, material);
      this.triangles.push(triangle);
      this.mesh.add(triangle);
    }

    this.scene.add(this.mesh);

    // Position camera to fit mesh
    const meshSize = Math.max(width, height) * scale;
    this.camera.position.z = meshSize * 1.2;
    this.camera.lookAt(0, 0, 0);
  }

  public updateUserLocation(longitude: number, latitude: number): void {
    if (this.userLocation) {
      this.scene.remove(this.userLocation);
    }

    // Create user location marker
    const geometry = new THREE.CircleGeometry(10, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0x0000ff,
      side: THREE.DoubleSide
    });
    this.userLocation = new THREE.Mesh(geometry, material);

    // Position the marker
    // Scale coordinates to match mesh scale
    if (this.mesh) {
      const scale = this.mesh.scale.x;
      this.userLocation.position.set(longitude * scale, latitude * scale, 1);
      this.scene.add(this.userLocation);
    }
  }

  public selectTriangle(index: number): void {
    // Reset previously selected triangle
    if (this.selectedTriangleIndex >= 0 && this.selectedTriangleIndex < this.triangles.length) {
      (this.triangles[this.selectedTriangleIndex].material as THREE.LineBasicMaterial).color.setHex(0x000000);
    }

    // Set new selected triangle
    if (index >= 0 && index < this.triangles.length) {
      (this.triangles[index].material as THREE.LineBasicMaterial).color.setHex(0xff0000);
      this.selectedTriangleIndex = index;
    } else {
      this.selectedTriangleIndex = -1;
    }
  }

  public getIntersectedTriangle(x: number, y: number): number {
    if (!this.mesh) return -1;

    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1
    );

    this.raycaster.setFromCamera(mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.triangles, false);

    if (intersects.length > 0) {
      return this.triangles.indexOf(intersects[0].object as THREE.LineSegments);
    }

    return -1;
  }

  public setSize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    this.triangles.forEach(triangle => {
      triangle.geometry.dispose();
      (triangle.material as THREE.Material).dispose();
    });
    if (this.userLocation) {
      this.userLocation.geometry.dispose();
      (this.userLocation.material as THREE.Material).dispose();
    }
    this.renderer.dispose();
  }
}
