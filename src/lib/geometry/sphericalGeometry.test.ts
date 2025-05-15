import {
  Vector3D,
  LatLng,
  Triangle,
  latLngToCartesian,
  cartesianToLatLng,
  sphericalMidpoint,
  greatCircleDistance,
  subdivideTriangle,
  sphericalTriangleArea,
  generateIcosahedronVertices,
  generateIcosahedronFaces,
  mercatorToLatLng,
  latLngToMercator,
  isPointInSphericalTriangle
} from './sphericalGeometry';

// Helper function to check if values are close to each other within a certain tolerance
function expectNearEqual(actual: number, expected: number, tolerance = 1e-6): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

// Helper function to check if Vector3D arrays are close to each other
function expectVectorNearEqual(actual: Vector3D, expected: Vector3D, tolerance = 1e-6): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) {
    expectNearEqual(actual[i], expected[i], tolerance);
  }
}

// Helper function to check if LatLng arrays are close to each other
function expectLatLngNearEqual(actual: LatLng, expected: LatLng, tolerance = 1e-6): void {
  expect(actual.length).toBe(expected.length);
  // For longitude (index 1), we need to handle the -180/180 boundary
  expectNearEqual(actual[0], expected[0], tolerance); // Latitude
  
  // Normalize longitudes to range -180 to 180 before comparing
  const normLng1 = ((actual[1] + 540) % 360) - 180;
  const normLng2 = ((expected[1] + 540) % 360) - 180;
  expectNearEqual(normLng1, normLng2, tolerance);
}

describe('latLngToCartesian', () => {
  test('should convert equator/prime meridian (0, 0) correctly', () => {
    const result = latLngToCartesian(0, 0);
    expectVectorNearEqual(result, [1, 0, 0]);
  });

  test('should convert north pole (90, 0) correctly', () => {
    const result = latLngToCartesian(90, 0);
    expectVectorNearEqual(result, [0, 0, 1]);
  });

  test('should convert south pole (-90, 0) correctly', () => {
    const result = latLngToCartesian(-90, 0);
    expectVectorNearEqual(result, [0, 0, -1]);
  });

  test('should convert (0, 90) correctly', () => {
    const result = latLngToCartesian(0, 90);
    expectVectorNearEqual(result, [0, 1, 0]);
  });

  test('should convert (0, -90) correctly', () => {
    const result = latLngToCartesian(0, -90);
    expectVectorNearEqual(result, [0, -1, 0]);
  });

  test('should handle arbitrary coordinates correctly', () => {
    const result = latLngToCartesian(45, 45);
    const expected: Vector3D = [
      Math.cos(Math.PI / 4) * Math.cos(Math.PI / 4),
      Math.cos(Math.PI / 4) * Math.sin(Math.PI / 4),
      Math.sin(Math.PI / 4)
    ];
    expectVectorNearEqual(result, expected);
  });
});

describe('cartesianToLatLng', () => {
  test('should convert [1, 0, 0] to [0, 0]', () => {
    const result = cartesianToLatLng([1, 0, 0]);
    expectLatLngNearEqual(result, [0, 0]);
  });

  test('should convert [0, 0, 1] to [90, 0]', () => {
    const result = cartesianToLatLng([0, 0, 1]);
    expectLatLngNearEqual(result, [90, 0]);
  });

  test('should convert [0, 0, -1] to [-90, 0]', () => {
    const result = cartesianToLatLng([0, 0, -1]);
    expectLatLngNearEqual(result, [-90, 0]);
  });

  test('should convert [0, 1, 0] to [0, 90]', () => {
    const result = cartesianToLatLng([0, 1, 0]);
    expectLatLngNearEqual(result, [0, 90]);
  });

  test('should convert [0, -1, 0] to [0, -90]', () => {
    const result = cartesianToLatLng([0, -1, 0]);
    expectLatLngNearEqual(result, [0, -90]);
  });

  test('should handle non-unit vectors by normalizing them', () => {
    const result = cartesianToLatLng([2, 0, 0]);
    expectLatLngNearEqual(result, [0, 0]);
  });

  test('should be the inverse of latLngToCartesian', () => {
    const coords: LatLng[] = [
      [0, 0], [45, 45], [90, 0], [-90, 0], [0, 180], [30, -120]
    ];
    
    for (const coord of coords) {
      const cartesian = latLngToCartesian(coord[0], coord[1]);
      const latLng = cartesianToLatLng(cartesian);
      expectLatLngNearEqual(latLng, coord);
    }
  });
});

describe('sphericalMidpoint', () => {
  test('should find midpoint between two points on same longitude', () => {
    const point1: LatLng = [0, 0];
    const point2: LatLng = [90, 0];
    const midpoint = sphericalMidpoint(point1, point2);
    expectLatLngNearEqual(midpoint, [45, 0]);
  });

  test('should find midpoint between two points on same latitude', () => {
    const point1: LatLng = [0, 0];
    const point2: LatLng = [0, 90];
    const midpoint = sphericalMidpoint(point1, point2);
    expectLatLngNearEqual(midpoint, [0, 45]);
  });

  test('should find midpoint between antipodal points', () => {
    const point1: LatLng = [0, 0];
    const point2: LatLng = [0, 180];
    // Any point on the equator 90 degrees from both points is a valid midpoint
    // Due to numerical precision, we'll just verify that the midpoint is on the equator
    const midpoint = sphericalMidpoint(point1, point2);
    expectNearEqual(midpoint[0], 0, 1e-6); // Should be on equator (lat = 0)
  });

  test('should handle two identical points', () => {
    const point: LatLng = [45, 45];
    const midpoint = sphericalMidpoint(point, point);
    expectLatLngNearEqual(midpoint, point);
  });

  test('should find midpoint between arbitrary points', () => {
    const point1: LatLng = [30, 30];
    const point2: LatLng = [60, 60];
    const midpoint = sphericalMidpoint(point1, point2);
    
    // Verify that distances from midpoint to each point are approximately equal
    const dist1 = greatCircleDistance(midpoint, point1);
    const dist2 = greatCircleDistance(midpoint, point2);
    expectNearEqual(dist1, dist2, 1e-6);
  });
});

describe('greatCircleDistance', () => {
  const EARTH_RADIUS_KM = 6371; // Earth radius in kilometers
  const quarterEarthCircumference = (Math.PI / 2) * EARTH_RADIUS_KM;
  const halfEarthCircumference = Math.PI * EARTH_RADIUS_KM;

  test('should return 0 for same point', () => {
    const point: LatLng = [45, 45];
    expect(greatCircleDistance(point, point)).toBe(0);
  });

  test('should calculate quarter earth circumference correctly', () => {
    const point1: LatLng = [0, 0];
    const point2: LatLng = [0, 90]; // 90 degrees along equator
    const distance = greatCircleDistance(point1, point2);
    expectNearEqual(distance, quarterEarthCircumference, 1);
  });

  test('should calculate half earth circumference correctly', () => {
    const point1: LatLng = [0, 0];
    const point2: LatLng = [0, 180]; // 180 degrees along equator
    const distance = greatCircleDistance(point1, point2);
    expectNearEqual(distance, halfEarthCircumference, 1);
  });

  test('should be symmetric', () => {
    const point1: LatLng = [30, 45];
    const point2: LatLng = [60, -30];
    const distance1 = greatCircleDistance(point1, point2);
    const distance2 = greatCircleDistance(point2, point1);
    expect(distance1).toBe(distance2);
  });
  
  test('should calculate distance from pole to pole correctly', () => {
    const northPole: LatLng = [90, 0];
    const southPole: LatLng = [-90, 0];
    const distance = greatCircleDistance(northPole, southPole);
    expectNearEqual(distance, halfEarthCircumference, 1);
  });
});

describe('subdivideTriangle', () => {
  test('should subdivide equilateral triangle correctly', () => {
    // Create an equilateral triangle around north pole
    const triangle: Triangle = [
      [60, 0], [60, 120], [60, 240]
    ];
    
    const subtriangles = subdivideTriangle(triangle);
    
    // Should produce 4 triangles
    expect(subtriangles.length).toBe(4);
    
    // Each subtriangle should have 3 vertices
    subtriangles.forEach(t => {
      expect(t.length).toBe(3);
    });

    // Check that each subdivision shares at least one point with the original triangle
    const originalPoints = new Set(triangle.map(p => JSON.stringify(p)));
    subtriangles.forEach(t => {
      const hasCommonPoint = t.some(p => originalPoints.has(JSON.stringify(p)));
      expect(hasCommonPoint).toBe(true);
    });
    
    // Verify that the center subtriangle doesn't share any vertices with the original
    const centerTriangle = subtriangles[3]; // By convention in our function
    const centerHasOriginalVertex = centerTriangle.some(p => 
      originalPoints.has(JSON.stringify(p))
    );
    expect(centerHasOriginalVertex).toBe(false);
  });

  test('should preserve total area approximately', () => {
    const triangle: Triangle = [
      [0, 0], [0, 90], [45, 45]
    ];
    
    const originalArea = sphericalTriangleArea(triangle);
    const subtriangles = subdivideTriangle(triangle);
    
    const totalSubArea = subtriangles.reduce(
      (sum, t) => sum + sphericalTriangleArea(t), 0
    );
    
    // Areas should be approximately equal (within 5% to account for spherical geometry)
    expectNearEqual(totalSubArea / originalArea, 1, 0.05);
  });
});

describe('sphericalTriangleArea', () => {
  test('should calculate area correctly for a triangle with 90 degree angles', () => {
    // Triangle with vertices at north pole, equator at prime meridian, and equator at 90E
    const triangle: Triangle = [
      [90, 0], [0, 0], [0, 90]
    ];
    
    // Area should be 1/8 of the earth's surface
    const expectedArea = 4 * Math.PI * 6371 * 6371 / 8;
    const area = sphericalTriangleArea(triangle);
    
    expectNearEqual(area, expectedArea, expectedArea * 0.01); // Within 1%
  });

  test('should return 0 for degenerate triangle (all points in a line)', () => {
    const triangle: Triangle = [
      [0, 0], [0, 45], [0, 90]
    ];
    
    const area = sphericalTriangleArea(triangle);
    expectNearEqual(area, 0, 1); // Very close to 0
  });

  test('should return reasonable value for small triangle', () => {
    // Small triangle near the equator
    const triangle: Triangle = [
      [1, 1], [1, 2], [2, 1]
    ];
    
    const area = sphericalTriangleArea(triangle);
    expect(area).toBeGreaterThan(0);
    expect(area).toBeLessThan(12000); // Much smaller than 1% of earth surface
  });
});

describe('generateIcosahedronVertices', () => {
  test('should generate exactly 12 vertices', () => {
    const vertices = generateIcosahedronVertices();
    expect(vertices.length).toBe(12);
  });

  test('all vertices should be on the unit sphere', () => {
    const vertices = generateIcosahedronVertices();
    
    vertices.forEach(latLng => {
      const [lat, lng] = latLng;
      // Latitude should be between -90 and 90
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
      
      // Longitude should be between -180 and 180
      expect(lng).toBeGreaterThanOrEqual(-180);
      expect(lng).toBeLessThanOrEqual(180);
      
      // Check that point is on unit sphere
      const cartesian = latLngToCartesian(lat, lng);
      const magnitude = Math.sqrt(
        cartesian[0] * cartesian[0] + 
        cartesian[1] * cartesian[1] + 
        cartesian[2] * cartesian[2]
      );
      expectNearEqual(magnitude, 1);
    });
  });

  test('vertices should be approximately equidistant', () => {
    const vertices = generateIcosahedronVertices();
    
    // Calculate distance between first vertex and all others
    const firstVertex = vertices[0];
    const distances = vertices.slice(1).map(v => greatCircleDistance(firstVertex, v));
    
    // All distances should be approximately the same
    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    
    // Verify all distances are within 1% of each other
    distances.forEach(distance => {
      expectNearEqual(distance, avgDistance, avgDistance * 0.01);
    });
  });
});

describe('generateIcosahedronFaces', () => {
  test('should generate exactly 20 faces', () => {
    const faces = generateIcosahedronFaces();
    expect(faces.length).toBe(20);
  });

  test('each face should be a valid triangle (3 vertices)', () => {
    const faces = generateIcosahedronFaces();
    
    faces.forEach(face => {
      expect(face.length).toBe(3);
      
      // Indices should be valid (0-11)
      face.forEach(index => {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThanOrEqual(11);
      });
    });
  });

  test('faces should share edges properly', () => {
    const faces = generateIcosahedronFaces();
    
    // Create a map to count how many times each edge appears
    const edgeCount = new Map<string, number>();
    
    faces.forEach(face => {
      // For each face, there are 3 edges
      for (let i = 0; i < 3; i++) {
        const v1 = face[i];
        const v2 = face[(i + 1) % 3];
        
        // Create a canonical edge representation (smaller index first)
        const edge = v1 < v2 ? `${v1}-${v2}` : `${v2}-${v1}`;
        
        // Count this edge
        edgeCount.set(edge, (edgeCount.get(edge) || 0) + 1);
      }
    });
    
    // In a valid icosahedron, each edge connects exactly 2 faces
    // Therefore, each edge should appear exactly twice
    for (const [edge, count] of edgeCount.entries()) {
      expect(count).toBe(2);
    }
  });
});

describe('mercatorToLatLng and latLngToMercator', () => {
  test('should convert equator coordinates correctly', () => {
    // Points along the equator
    const testPoints = [
      [0, 0],   // Prime meridian
      [0.25, 0.5], // 90° longitude
      [0.5, 0.5],  // 180° longitude
      [0.75, 0.5]  // 270° longitude
    ];
    
    testPoints.forEach(([x, y]) => {
      const [lat, lng] = mercatorToLatLng(x, y);
      expectNearEqual(lat, 0, 1e-6); // Should be on equator
      
      // Convert back and check
      const [mercX, mercY] = latLngToMercator(lat, lng);
      expectNearEqual(mercX, x, 1e-6);
      expectNearEqual(mercY, y, 1e-6);
    });
  });

  test('should convert various latitudes correctly', () => {
    // Test points at prime meridian, different latitudes
    const testLatitudes = [-60, -30, 0, 30, 60];
    
    testLatitudes.forEach(lat => {
      const [x, y] = latLngToMercator(lat, 0);
      const [convLat, convLng] = mercatorToLatLng(x, y);
      
      expectNearEqual(convLat, lat, 0.01); // Small tolerance for floating point
      expectNearEqual(convLng, 0, 0.01);
    });
  });

  test('should handle edge cases', () => {
    // Test near poles (but not exactly at poles, which are invalid in Mercator)
    const nearNorthPole = latLngToMercator(89, 0);
    const nearSouthPole = latLngToMercator(-89, 0);
    
    // y should approach 0 for north pole and 1 for south pole
    expect(nearNorthPole[1]).toBeLessThan(0.1);
    expect(nearSouthPole[1]).toBeGreaterThan(0.9);
    
    // Test points at the date line
    const dateLineEast = latLngToMercator(0, 180);
    const dateLineWest = latLngToMercator(0, -180);
    
    // Both should map to the same mercator x-coordinate
    expectNearEqual(dateLineEast[0], 1, 1e-6);
    expectNearEqual(dateLineWest[0], 0, 1e-6);
  });
  
  test('should clamp latitudes to prevent singularities', () => {
    // Try to convert extreme values that would cause math errors
    const northPole = latLngToMercator(90, 0);
    const southPole = latLngToMercator(-90, 0);
    
    // Should produce finite values, not Infinity
    expect(isFinite(northPole[1])).toBe(true);
    expect(isFinite(southPole[1])).toBe(true);
  });
});

describe('isPointInSphericalTriangle', () => {
  test('should detect points clearly inside triangle', () => {
    // Create a triangle in northern hemisphere
    const triangle: Triangle = [
      [30, 0], [30, 60], [60, 30]
    ];
    
    // A point near the center of the triangle
    const center: LatLng = [40, 30];
    
    expect(isPointInSphericalTriangle(center, triangle)).toBe(true);
  });

  test('should detect points clearly outside triangle', () => {
    // Create a triangle in northern hemisphere
    const triangle: Triangle = [
      [30, 0], [30, 60], [60, 30]
    ];
    
    // Points outside the triangle in different directions
    const outsidePoints: LatLng[] = [
      [0, 0],    // Far south
      [45, 90],  // Far east
      [80, 30]   // Far north
    ];
    
    outsidePoints.forEach(point => {
      expect(isPointInSphericalTriangle(point, triangle)).toBe(false);
    });
  });

  test('should handle points on vertices', () => {
    const triangle: Triangle = [
      [0, 0], [0, 90], [45, 45]
    ];
    
    // Points at each vertex
    triangle.forEach(vertex => {
      expect(isPointInSphericalTriangle(vertex, triangle)).toBe(true);
    });
  });

  test('should handle points on edges', () => {
    const triangle: Triangle = [
      [0, 0], [0, 90], [45, 45]
    ];
    
    // Points on each edge (midpoints)
    const edgePoints: LatLng[] = [
      sphericalMidpoint(triangle[0], triangle[1]),
      sphericalMidpoint(triangle[1], triangle[2]),
      sphericalMidpoint(triangle[2], triangle[0])
    ];
    
    edgePoints.forEach(point => {
      expect(isPointInSphericalTriangle(point, triangle)).toBe(true);
    });
  });

  test('should handle edge cases near poles', () => {
    // Triangle covering the north pole
    const polarTriangle: Triangle = [
      [80, 0], [80, 120], [80, 240]
    ];
    
    // North pole should be inside
    expect(isPointInSphericalTriangle([90, 0], polarTriangle)).toBe(true);
    
    // Point near south pole should be outside
    expect(isPointInSphericalTriangle([-85, 0], polarTriangle)).toBe(false);
  });
});
