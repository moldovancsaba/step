# TDD Protocol - STEP Project

## Purpose

To define the specific tools, conventions, and procedures for implementing Test-Driven Development (TDD) within the `step` project, ensuring consistency and effective automated verification driven by the AI. This protocol supports the TDD steps outlined in `05_Definition_of_Done.md`.

---

## Applies To

All development work involving automated testing within the path:
`/Users/moldovan/Projects/step/`

Must be used in conjunction with all other current project rule files (`README.md`, `01_Roadmap.md`, `02_Technology_Stack.md`, `03_AI_Consent_Permissions.md`, `05_Definition_of_Done.md` through `11_Release_Notes.md`).

---

## Tools & Setup

1.  **Test Runner:** **Jest**
    * Configuration: `jest.config.js` (or `jest.config.ts`).
    * Setup: `jest.setup.js` (or `jest.setup.ts`) for global setup (e.g., `@testing-library/jest-dom`).
    * Dependencies: `jest`, `@types/jest`, `jest-environment-jsdom`. Install using `npm install --save-dev ...`. Document in `02_Technology_Stack.md`.

2.  **Component Testing:** **React Testing Library (RTL)**
    * Purpose: Test React components from user perspective.
    * Dependencies: `@testing-library/react`, `@testing-library/jest-dom`. Install using `npm install --save-dev ...`. Document in `02_Technology_Stack.md`.

3.  **Execution Command:**
    * Primary command: `npm test` (defined in `package.json` to run `jest`). Use for DoD (`05_Definition_of_Done.md`) verification steps.

---

## Test File Conventions

1.  **Location:** Alongside the code file they test.
    * Example: `src/app/components/Input.tsx` tests -> `src/app/components/Input.test.tsx`.
    * Example: `src/lib/actions.ts` tests -> `src/lib/actions.test.ts`.

2.  **Naming:** Use the format `[filename].test.[ts|tsx]`.

3.  **3D World/Map Testing Locations:**
    * Icosahedron Vertex Tests: `src/lib/geometry/icosahedron.test.ts`
    * Triangle Division Tests: `src/lib/geometry/triangleDivision.test.ts`
    * Map Integration Tests: `src/app/components/WorldMap/WorldMap.test.tsx`
    * Color Progression Tests: `src/lib/utils/colorGradient.test.ts`

4.  **Sphere Mapping Test Examples:**
    ```typescript
    // src/lib/geometry/icosahedron.test.ts
    describe('Icosahedron Mapping System', () => {
      it('generates 12 vertices on unit sphere with correct distribution', () => {
        const vertices = generateIcosahedronVertices();
        expect(vertices).toHaveLength(12);
        // Verify vertices are equidistant from origin (unit sphere)
        vertices.forEach(vertex => {
          expect(calculateMagnitude(vertex)).toBeCloseTo(1.0, 5);
        });
      });
      
      it('divides base_face_01 into 4 equal triangles', () => {
        const baseFace = getBaseFace(1);
        const subTriangles = divideTriangle(baseFace);
        expect(subTriangles).toHaveLength(4);
        // Verify areas are approximately equal
        const areas = subTriangles.map(triangle => calculateTriangleArea(triangle));
        const expectedArea = calculateTriangleArea(baseFace) / 4;
        areas.forEach(area => {
          expect(area).toBeCloseTo(expectedArea, 2);
        });
      });
    });
    
    // src/lib/utils/colorGradient.test.ts
    describe('Triangle Color Progression', () => {
      it('returns correct grey value based on click count', () => {
        expect(getTriangleColor(0)).toBe('#ffffff'); // Snow white
        expect(getTriangleColor(1)).toBe('#e6e6e6'); // 10% grey
        expect(getTriangleColor(5)).toBe('#7f7f7f'); // 50% grey
        expect(getTriangleColor(10)).toBe('#191919'); // 90% grey
      });
      
      it('returns red for level 19 triangles with 11 clicks', () => {
        expect(getTriangleColor(11, 19)).toBe('#ff0000'); // Red
      });
    });
    ```

---

## TDD Workflow Steps (AI Instructions)

*(Corresponds to steps in `05_Definition_of_Done.md`)*

1.  Requirement Received (`01_Roadmap.md`).
2.  Write Failing Test(s): Create `*.test.*` file; write `test(...)`/`it(...)`; use RTL for components; write failing `expect(...)` assertions; run `npm test`; verify failure (Log per `08_AI_Verification_Protocol.md`).
3.  Implement Minimal Code: Modify corresponding `.ts`/`.tsx` file.
4.  Run Tests & Verify Pass: Run `npm test`; verify pass (Log per `08_AI_Verification_Protocol.md`); repeat Step 3 if needed.
5.  Refactor: Clean code; run `npm test`; verify pass (Log per `08_AI_Verification_Protocol.md`).

---

## Best Practices & Considerations

- Test Isolation: Use `beforeEach`/`afterEach`.
- Focus on Behavior: Test *what*, not *how*.
- Mocking: Use `jest.fn()`/`jest.mock()` for external dependencies (DB, APIs). Isolate unit under test. Avoid production DB in unit tests.
- Keep Tests Fast.
- Readability: Clear descriptions `test('should do X when Y happens', ...)`.
- Follow Icosahedron Test Naming Convention: 
  * Use descriptive test cases that match geometric operations
  * Example: `describes('Face Division Level N', () => {...})`
  * Example: `it('projects point [x,y,z] to cartographic [lat,long]', () => {...})`

---

## Maintenance

- Review this protocol if testing tools (`02_Technology_Stack.md`) change or major architecture shifts occur.
- Log useful testing patterns or complex mocking strategies discovered during development in `09_Dev_Log_Lessons.md`.
