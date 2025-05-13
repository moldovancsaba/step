import { handleTriangleClick, TriangleState } from './clickHandler';
import { Face, Vector3 } from '../geometry/icosahedron';
import { divideTriangle } from '../geometry/triangleDivision';

describe('Triangle Click Interaction', () => {
  describe('Click Counter and Color Progression', () => {
    it('increments gray level by 10% per click up to 100%', () => {
      const triangle: TriangleState = {
        face: { a: 0, b: 1, c: 2 },
        vertices: [
          { x: 0, y: 0, z: 1 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 }
        ],
        clickCount: 0,
        level: 0,
        color: '#ffffff' // Initial white color
      };

      // Test clicks 1-10
      for (let i = 1; i <= 10; i++) {
        const result = handleTriangleClick(triangle);
        const expectedGray = i * 10;
        const expectedHex = rgbToHex(255 - expectedGray * 2.55);
        expect(result.color).toBe(expectedHex);
        expect(result.clickCount).toBe(i);
        triangle.clickCount = result.clickCount;
        triangle.color = result.color;
      }
    });

    it('subdivides triangle on 11th click and resets color', () => {
      const triangle: TriangleState = {
        face: { a: 0, b: 1, c: 2 },
        vertices: [
          { x: 0, y: 0, z: 1 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 }
        ],
        clickCount: 10,
        level: 0,
        color: '#191919' // 90% gray
      };

      const result = handleTriangleClick(triangle);
      
      expect(result.subdivided).toBe(true);
      expect(result.newTriangles).toHaveLength(4);
      result.newTriangles?.forEach(newTriangle => {
        expect(newTriangle.color).toBe('#ffffff');
        expect(newTriangle.clickCount).toBe(0);
        expect(newTriangle.level).toBe(1);
      });
    });

    it('turns triangle red at level 19 on 11th click', () => {
      const triangle: TriangleState = {
        face: { a: 0, b: 1, c: 2 },
        vertices: [
          { x: 0, y: 0, z: 1 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 }
        ],
        clickCount: 10,
        level: 19,
        color: '#191919' // 90% gray
      };

      const result = handleTriangleClick(triangle);
      
      expect(result.color).toBe('#ff0000');
      expect(result.clickCount).toBe(11);
      expect(result.subdivided).toBe(false);
      expect(result.newTriangles).toBeUndefined();
    });
  });
});

// Helper function to convert RGB value to hex color string
function rgbToHex(value: number): string {
  const hex = Math.round(value).toString(16).padStart(2, '0');
  return `#${hex}${hex}${hex}`;
}

