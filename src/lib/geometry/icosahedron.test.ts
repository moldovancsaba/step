import { 
  generateIcosahedronVertices, 
  generateIcosahedronFaces, 
  cartesianToSpherical, 
  calculateTriangleArea,
  Vector3,
  Face
} from './icosahedron';

describe('Icosahedron Mapping System', () => {
  
  describe('Vertex Generation', () => {
    it('generates 12 vertices on unit sphere', () => {
      const vertices = generateIcosahedronVertices();
      expect(vertices).toHaveLength(12);
    });

    it('places all vertices at distance 1.0 from origin (unit sphere)', () => {
      const vertices = generateIcosahedronVertices();
      vertices.forEach(vertex => {
        const magnitude = Math.sqrt(
          vertex.x * vertex.x + 
          vertex.y * vertex.y + 
          vertex.z * vertex.z
        );
        expect(magnitude).toBeCloseTo(1.0, 5);
      });
    });

    it('correctly positions North and South poles', () => {
      const vertices = generateIcosahedronVertices();
      
      // Find north pole (vertex with z = 1 or very close)
      const northPole = vertices.find(vertex => Math.abs(vertex.z - 1.0) < 1e-5);
      expect(northPole).toBeDefined();
      
      if (northPole) {
        const spherical = cartesianToSpherical(northPole);
        expect(spherical.latitude).toBeCloseTo(90.0, 5);
      }
      
      // Find south pole (vertex with z = -1 or very close)
      const southPole = vertices.find(vertex => Math.abs(vertex.z + 1.0) < 1e-5);
      expect(southPole).toBeDefined();
      
      if (southPole) {
        const spherical = cartesianToSpherical(southPole);
        expect(spherical.latitude).toBeCloseTo(-90.0, 5);
      }
    });
  });

  describe('Face Generation', () => {
    it('generates 20 triangular faces', () => {
      const vertices = generateIcosahedronVertices();
      const faces = generateIcosahedronFaces(vertices);
      expect(faces).toHaveLength(20);
    });

    it('creates faces with valid vertex indices', () => {
      const vertices = generateIcosahedronVertices();
      const faces = generateIcosahedronFaces(vertices);
      
      faces.forEach(face => {
        expect(face.a).toBeGreaterThanOrEqual(0);
        expect(face.b).toBeGreaterThanOrEqual(0);
        expect(face.c).toBeGreaterThanOrEqual(0);
        
        expect(face.a).toBeLessThan(vertices.length);
        expect(face.b).toBeLessThan(vertices.length);
        expect(face.c).toBeLessThan(vertices.length);
      });
    });

    it('forms faces with approximately equal areas (±0.1% tolerance)', () => {
      const vertices = generateIcosahedronVertices();
      const faces = generateIcosahedronFaces(vertices);
      
      const areas = faces.map(face => {
        const vertexA = vertices[face.a];
        const vertexB = vertices[face.b];
        const vertexC = vertices[face.c];
        return calculateTriangleArea(vertexA, vertexB, vertexC);
      });
      
      // All areas should be approximately equal
      const averageArea = areas.reduce((sum, area) => sum + area, 0) / areas.length;
      
      areas.forEach(area => {
        const percentDifference = Math.abs(area - averageArea) / averageArea * 100;
        expect(percentDifference).toBeLessThanOrEqual(0.1);
      });
    });
  });
});

