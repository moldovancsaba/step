# Release Notes - Done Is Better

## v0.9.5 - Test Infrastructure and Dependency Management Stabilization - 2025-05-14

### Fixes & Improvements

* **Dependency Conflict Resolution:** Resolved compatibility issues between eslint-plugin-react-hooks and eslint-config-airbnb
* **Package Management:** Updated .gitignore to stop ignoring package-lock.json for better dependency version tracking
* **Test Infrastructure Setup:** Completed comprehensive test environment configuration (Task: TSK-002)

### Technical Implementation Details

* **Testing Framework Enhancements:**
  - Configured Jest with @swc/jest for faster TSX/JSX transforms
  - Added proper mocks for matchMedia and IntersectionObserver
  - Created Jest mock files for CSS modules and static assets
  - Set up TypeScript configuration for react-dom testing
  - Added example Button component with corresponding tests

* **Dependency Management:**
  - Downgraded eslint-plugin-react-hooks to v4.6.0 to resolve conflicts with eslint-config-airbnb
  - Added missing Tailwind plugins for project requirements
  - Installed identity-obj-proxy for CSS module mocking

### Validation

* All build errors resolved successfully
* Local build verified with no errors or warnings
* Jest test configuration confirmed working with example component tests

### Deployment

* **Commit:** `4a16a0e`
* **Tag:** `v0.9.5`
* **Platform:** Vercel
* **URL:** `https://step-git-main-narimato.vercel.app`
* **Deployment Date:** 2025-05-14T19:14:00+02:00

---

## v0.6.0 - Click Interaction Implementation - 2025-05-14

### Features

* **Triangle Click Interaction:** (Task: TSK-001)
  - Color progression from white to gray (10% increments)
  - Subdivision triggering on 11th click
  - Red color for level 19 triangles
  - State management for triangle interactions

### Technical Implementation Details

* **Core Components:**
  - `src/lib/interaction/clickHandler.ts`: Click handling implementation
  - `src/lib/interaction/clickHandler.test.ts`: Test suite

* **Key Features:**
  - State management for triangle properties
  - Color calculation and progression
  - Integration with triangle division

### Validation

* All automated tests pass (22 tests total):
  - Color progression verification
  - Subdivision triggering
  - Level 19 behavior
  - Integration with existing geometry

### Deployment

* **Commit:** `acd005d`
* **Tag:** `v0.6.0`
* **Platform:** Vercel
* **URL:** `https://step-kegh3kv5t-narimato.vercel.app`
* **Deployment Date:** 2025-05-14T00:30:00+02:00

---

## v0.5.0 - Triangle Division Implementation - 2025-05-14

### Features

* **Triangle Division System:** (Task: TSK-001)
  - Divide triangles into 4 equal subtriangles
  - Support 19 levels of recursive subdivision
  - Maintain geometric precision on sphere surface

### Technical Implementation Details

* **Core Components:**
  - `src/lib/geometry/triangleDivision.ts`: Division implementation
  - `src/lib/geometry/triangleDivision.test.ts`: Test suite

* **Key Features:**
  - Great circle arc midpoint calculation
  - Area-preserving subdivision
  - Vertex normalization to unit sphere

### Validation

* All automated tests pass (19 tests total):
  - Equal area verification
  - Vertex positioning
  - Deep recursion support
  - Integration with existing geometry

### Deployment

* **Commit:** `4fe49ba`
* **Tag:** `v0.5.0`
* **Platform:** Vercel
* **URL:** `https://step-gy1exaiyw-narimato.vercel.app`
* **Deployment Date:** 2025-05-14T00:10:00+02:00

---

## v0.4.0 - OpenStreetMap Integration - 2025-05-13

### Features

* **OpenStreetMap Integration:** (Task: TSK-001)
  - OSM data loading with <2s performance
  - Coordinate conversion between triangle mesh and OSM
  - Triangle rendering with visibility calculation
  - Pan and zoom interaction handlers

### Technical Implementation Details

* **Core Components:**
  - `src/lib/map/openStreetMap.ts`: Map integration implementation
  - `src/lib/map/openStreetMap.test.ts`: Test suite

* **Testing Infrastructure:**
  - Configured Jest with jsdom environment
  - Added map interaction testing capabilities

### Validation

* All automated tests pass (16 tests total):
  - OSM data loading
  - Coordinate conversion
  - Triangle rendering
  - Map interactions

### Deployment

* **Commit:** `25696b4`
* **Tag:** `v0.4.0`
* **Platform:** Vercel
* **URL:** `https://step-gsg5h86fm-narimato.vercel.app`
* **Deployment Date:** 2025-05-13T23:45:00+02:00

---


---

*(Repeat the above structure for each new release, adding the newest entry at the top)*