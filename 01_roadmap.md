# Project Roadmap

## Purpose

To outline the planned features and tasks for the "STEP" project development cycle, ordered by priority. This guides the sequential implementation process defined in `06_Sequential_Development_Rule.md`.

## Current Tasks

Task ID: TSK-001
Description: Implement Core 2D Icosahedron-based World Map MVP
Priority: 1
Status: Pending

**Features:**

1. **Triangle based Point Mapping**
   - Generate 12 vertices of a regular icosahedron stretched onto the 2D canvas of openstreetmap
   - Map vertices to cartographic coordinates (latitude/longitude)
   - Define 20 triangular faces connecting the vertices
   - **Acceptance Criteria:**
     * North (90.00000,0.00000) and South (-90.00000,0.00000) poles properly mapped

2. **OpenStreetMap Integration**
   - Overlay icosahedron layout onto OpenStreetMap
   - Implement pan and zoom functionality
   - Handle coordinate conversion between triangle net and OSM
   - **User Acceptance Criteria:**
     * Map loads .osm.pbf files under 2 seconds
     * Triangles render correctly at all zoom levels
     * Pan/zoom controls function smoothly

3. **Triangle Division Logic**
   - Implement algorithm to divide triangles into 4 equal subtriangles
   - the new vertices of the new triangles are the vertices of the original triangle and the midpoints of the sides
   - Create side bisector points for subdivision
   - Support up to 19 levels of recursion

4. **Click Interaction Behavior**
   - Implement triangle click detection
   - Track click count per triangle
   - Trigger subdivision on 11th click
   - **User Acceptance Criteria:**
     * Click detection works at all zoom levels
     * Click counter increments correctly (0-10)
     * 11th click triggers subdivision accurately

5. **Color Progression System**
   - Implement color state management for triangles
   - Apply 10% gray increment per click (white→90% gray)
   - All color is 50% transparent
   - Reset color to white after subdivision
   - Apply red color at max subdivision (level 19)
   - **User Acceptance Criteria:**
     * Color changes match specification exactly
     * Subdivision resets color to white
     * Level 19 triangles turn red on 11th click
     * Color state persistence across session refreshes

Task ID: TSK-002
Description: Development and Running Environment Setup for STEP
Priority: 1
Status: Pending

**Environment Components:**

1. **Development Environment**
   - Configure Next.js 15.2.4 with TypeScript and strict mode
   - Set up React 19.0.0 with Zustand for state management
   - Implement Tailwind CSS for styling
   - Configure ESLint + Prettier with Airbnb ruleset
   - **Acceptance Criteria:**
     * Clean project initialization with no errors/warnings
     * TypeScript compiler runs with --strict flag
     * ESLint passes on all initial files
     * Hot reload works properly (≤1.5s refresh time)

2. **Database Integration**
   - Configure MongoDB Atlas for production
   - Implement Mongoose schemas for geometry storage
   - Set up proper environment variable handling

4. **Continuous Integration & Deployment**
   - Configure Vercel deployment pipeline
   - Set up GitHub Actions for CI/CD
   - Implement pre-commit hooks for code quality
   - Document deployment procedures


Task ID: TSK-003
Description: Implement Triangle Geometry and Rendering
Priority: 2
Status: Pending

**Implementation Steps:**

1. **Core Geometry Library**
   - Implement vertex generation for the Triangle system
   - Create face definition and connectivity logic
   - Build coordinate conversion utilities


2. **Basic Rendering Engine**
   - Implement initial map rendering component
   - Set up canvas/WebGL context for triangle drawing
   - Implement basic coloring system

Task ID: TSK-004
Description: Triangle Geometry Correction
Priority: 2
Status: Pending

**Implementation Steps:**

1. ** Triangle Conversion**
   - Implement vertex calculation ensuring perfect map placement
   - Calculate accurate triangle areas

2. **Coordinate System Enhancement**
   - Refine cartographic coordinate conversion for accuracy
   - Implement distance calculations
   - Create utilities for length and intersection computation

3. **Projection Accuracy Verification**
   - Implement validation routines for projection
   - Compare areas before and after projection to ensure uniformity
   - Add visualization aids for geometry debugging

Task ID: TSK-005
Description: Triangle Subdivision Enhancement
Priority: 2
Status: Pending

**Implementation Steps:**

1. ** Subdivision Algorithm**
   - Implement bisector calculations for edges
   - Ensure child triangles use proper geometry
   - Optimize calculation performance for recursive subdivisions

2. **Equal Area Division**
   - Refine subdivision to create 4 equal-area triangles with 5% accuracy
   - Implement geometric corrections to maintain area equality
   - Add area calculation and verification utilities

3. **Recursive Subdivision Stability**
   - Ensure stable subdivision across 19 levels
   - Prevent geometric drift in repeated subdivisions
   - Implement numerical stability safeguards




## Completed Tasks

(This section will be populated as tasks are fully completed according to `05_Definition_of_Done.md`.)
