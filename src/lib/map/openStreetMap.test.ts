import {
  loadOsmFile,
  convertIcosahedronToOsm,
  convertOsmToIcosahedron,
  renderTrianglesOnMap,
  setupMapInteractions,
  OsmCoordinate,
  MapBounds,
  ZoomLevel
} from './openStreetMap';
import { Vector3, SphericalCoordinates } from '../geometry/icosahedron';
import { generateIcosahedronVertices, generateIcosahedronFaces, cartesianToSpherical } from '../geometry/icosahedron';

describe('OpenStreetMap Integration', () => {
  
  describe('OSM Data Loading', () => {
    it('loads .osm.pbf files under 2 seconds', async () => {
      // Setup mock data file path
      const filePath = 'test-data.osm.pbf';
      
      // Measure loading time
      const startTime = Date.now();
      await loadOsmFile(filePath);
      const endTime = Date.now();
      const loadTimeMs = endTime - startTime;
      
      // Assert loading time is under 2000ms (2 seconds)
      expect(loadTimeMs).toBeLessThanOrEqual(2000);
    });
    
    it('returns correct data structure after loading OSM file', async () => {
      const osmData = await loadOsmFile('test-data.osm.pbf');
      
      // Check that osmData has the expected structure
      expect(osmData).toBeDefined();
      expect(osmData.nodes).toBeDefined();
      expect(osmData.ways).toBeDefined();
      expect(osmData.bounds).toBeDefined();
    });
  });
  
  describe('Coordinate Conversion', () => {
    it('converts icosahedron coordinates to OSM coordinates accurately', () => {
      // Test cases for known coordinates
      const testCases = [
        // North pole
        { 
          spherical: { latitude: 90, longitude: 0 },
          expected: { lat: 90, lon: 0 } 
        },
        // South pole
        { 
          spherical: { latitude: -90, longitude: 0 },
          expected: { lat: -90, lon: 0 } 
        },
        // Equator point
        { 
          spherical: { latitude: 0, longitude: 45 },
          expected: { lat: 0, lon: 45 } 
        }
      ];
      
      testCases.forEach(test => {
        const result = convertIcosahedronToOsm(test.spherical);
        expect(result.lat).toBeCloseTo(test.expected.lat, 5);
        expect(result.lon).toBeCloseTo(test.expected.lon, 5);
      });
    });
    
    it('converts OSM coordinates to icosahedron coordinates accurately', () => {
      // Test cases for known coordinates
      const testCases = [
        // North pole
        { 
          osm: { lat: 90, lon: 0 },
          expected: { latitude: 90, longitude: 0 } 
        },
        // South pole
        { 
          osm: { lat: -90, lon: 0 },
          expected: { latitude: -90, longitude: 0 } 
        },
        // Equator point
        { 
          osm: { lat: 0, lon: 45 },
          expected: { latitude: 0, longitude: 45 } 
        }
      ];
      
      testCases.forEach(test => {
        const result = convertOsmToIcosahedron(test.osm);
        expect(result.latitude).toBeCloseTo(test.expected.latitude, 5);
        expect(result.longitude).toBeCloseTo(test.expected.longitude, 5);
      });
    });
    
    it('maintains coordinate conversion precision for all icosahedron vertices', () => {
      // Generate icosahedron vertices
      const vertices = generateIcosahedronVertices();
      
      // Convert each vertex to spherical coordinates, then to OSM and back
      vertices.forEach(vertex => {
        const spherical = cartesianToSpherical(vertex);
        const osm = convertIcosahedronToOsm(spherical);
        const roundtrip = convertOsmToIcosahedron(osm);
        
        // Assert that the roundtrip conversion is close to the original
        expect(roundtrip.latitude).toBeCloseTo(spherical.latitude, 5);
        expect(roundtrip.longitude).toBeCloseTo(spherical.longitude, 5);
      });
    });
  });
  
  describe('Triangle Rendering', () => {
    it('renders triangles correctly at all zoom levels', () => {
      // Setup test map element
      const mapContainer = document.createElement('div');
      
      // Test at different zoom levels
      const zoomLevels: ZoomLevel[] = [1, 5, 10, 15, 20];
      
      // Generate icosahedron vertices and faces
      const vertices = generateIcosahedronVertices();
      const faces = generateIcosahedronFaces(vertices);
      
      zoomLevels.forEach(zoomLevel => {
        // Mock map bounds for this zoom level
        const bounds: MapBounds = {
          north: 85,
          south: -85,
          east: 180,
          west: -180,
          zoom: zoomLevel
        };
        
        // Render triangles at this zoom level
        const renderedTriangles = renderTrianglesOnMap(mapContainer, vertices, faces, bounds);
        
        // Assertions for rendering at each zoom level
        expect(renderedTriangles).toBeDefined();
        expect(renderedTriangles.trianglesRendered).toBeGreaterThan(0);
        expect(renderedTriangles.visibleTriangles).toBeGreaterThanOrEqual(1);
        
        // For higher zoom levels, we expect more detailed rendering
        if (zoomLevel > 10) {
          expect(renderedTriangles.triangleDetailLevel).toBeGreaterThan(5);
        }
      });
    });
    
    it('adjusts triangle visibility based on map viewport', () => {
      // Setup test map element
      const mapContainer = document.createElement('div');
      
      // Generate icosahedron data
      const vertices = generateIcosahedronVertices();
      const faces = generateIcosahedronFaces(vertices);
      
      // Test with different map viewports
      const viewports = [
        // Full world view
        { north: 85, south: -85, east: 180, west: -180, zoom: 1 },
        // European view
        { north: 60, south: 35, east: 30, west: -10, zoom: 5 },
        // City-level view
        { north: 48.9, south: 48.8, east: 2.4, west: 2.3, zoom: 15 }
      ];
      
      viewports.forEach(viewport => {
        const renderedTriangles = renderTrianglesOnMap(mapContainer, vertices, faces, viewport);
        
        // Different zoom levels should show different numbers of triangles
        if (viewport.zoom === 1) {
          // At zoom level 1, all 20 base triangles should be visible
          expect(renderedTriangles.visibleTriangles).toBeCloseTo(20, 0);
        } else if (viewport.zoom === 5) {
          // At zoom level 5, only triangles in Europe should be visible
          expect(renderedTriangles.visibleTriangles).toBeLessThan(20);
        } else if (viewport.zoom === 15) {
          // At city level, even fewer triangles should be visible
          expect(renderedTriangles.visibleTriangles).toBeLessThan(5);
        }
      });
    });
  });
  
  describe('Map Interaction', () => {
    it('handles pan interactions correctly', () => {
      // Setup test map element
      const mapContainer = document.createElement('div');
      
      // Setup map
      const map = setupMapInteractions(mapContainer);
      
      // Initial bounds
      const initialBounds = map.getBounds();
      
      // Simulate pan interaction
      map.panTo({ lat: 45, lon: 45 });
      
      // Get updated bounds
      const updatedBounds = map.getBounds();
      
      // Verify bounds have changed correctly
      expect(updatedBounds.center.lat).toBeCloseTo(45, 1);
      expect(updatedBounds.center.lon).toBeCloseTo(45, 1);
      expect(updatedBounds).not.toEqual(initialBounds);
    });
    
    it('handles zoom interactions correctly', () => {
      // Setup test map element
      const mapContainer = document.createElement('div');
      
      // Setup map
      const map = setupMapInteractions(mapContainer);
      
      // Initial zoom
      const initialZoom = map.getZoom();
      
      // Simulate zoom in interaction
      map.zoomIn();
      
      // Get updated zoom
      const zoomedInLevel = map.getZoom();
      
      // Verify zoom level has increased
      expect(zoomedInLevel).toBeGreaterThan(initialZoom);
      
      // Simulate zoom out interaction
      map.zoomOut();
      map.zoomOut();
      
      // Get updated zoom
      const zoomedOutLevel = map.getZoom();
      
      // Verify zoom level has decreased
      expect(zoomedOutLevel).toBeLessThan(zoomedInLevel);
    });
    
    it('renders triangles correctly after interaction', () => {
      // Setup test map element
      const mapContainer = document.createElement('div');
      
      // Generate icosahedron data
      const vertices = generateIcosahedronVertices();
      const faces = generateIcosahedronFaces(vertices);
      
      // Setup map with triangles
      const map = setupMapInteractions(mapContainer);
      let renderedTriangles = renderTrianglesOnMap(mapContainer, vertices, faces, map.getBounds());
      
      // Store initial render state
      const initialTriangleCount = renderedTriangles.visibleTriangles;
      
      // Simulate zoom in interaction
      map.zoomIn();
      map.zoomIn();
      
      // Re-render triangles after interaction
      renderedTriangles = renderTrianglesOnMap(mapContainer, vertices, faces, map.getBounds());
      
      // Verify triangle count has changed with zoom
      expect(renderedTriangles.visibleTriangles).not.toEqual(initialTriangleCount);
      
      // Simulate pan interaction
      map.panTo({ lat: 0, lon: 90 });
      
      // Re-render triangles after interaction
      renderedTriangles = renderTrianglesOnMap(mapContainer, vertices, faces, map.getBounds());
      
      // Verify visible triangles are appropriate for new view
      expect(renderedTriangles.visibleTriangles).toBeGreaterThanOrEqual(1);
    });
  });
});

