# Release Notes

## v1.0.0 (2025-05-19)
### Features
- Implemented new 20-triangle grid system between Arctic and Antarctic circles
- Defined vertices at three critical latitude bands: Equator (0°), Arctic Circle (+66.5°), and Antarctic Circle (-66.5°)
- Created a balanced grid with 10 north-pointing and 10 south-pointing isosceles triangles
- Enabled subdivision from any click coordinate inside a triangle using spherical interpolation

### Technical Enhancements
- Updated initial vertex creation with evenly spaced longitudes (72° intervals) across three latitude bands
- Rebuilt face definition to support the 20-triangle grid structure
- Enhanced subdivision functionality to work from arbitrary click points
- Removed click count requirement, replaced with proper spherical interpolation

### Technical Notes
- Maintained backward compatibility with existing projection and visualization systems
- Comprehensive testing confirms proper rendering of curved triangle edges
- Improved triangle hover and click interactions with refined visibility checks
- Full documentation update describing the new grid structure and subdivision rules

## v0.1.2 (2025-05-19)
### Features
- Successfully integrated Triangle component with curved edge rendering
- Completed visualization system with improved projection capabilities
- Enhanced SVG path generation for spherical triangles with proper curvature
- Implemented robust viewport bounds detection and antimeridian handling

### Technical Enhancements
- Standardized projection system across all components
  - Eliminated duplicate function definitions in projection.ts
  - Added comprehensive coordinate normalization
  - Improved date line crossing detection and handling
  - Enhanced debugging capabilities with strategic logging
- Optimized triangle mesh rendering with proper visibility checks
- Added support for different zoom levels and viewport configurations

### Technical Notes
- Successful build verification with the refactored projection system
- Improved development documentation to reflect the projection system architecture
- All components now use the standardized projection utilities

## v0.1.1 (2024-01-09)
### Bug Fixes
- Fixed ReactServerComponentsError in SimpleMeshView.tsx
  - Removed duplicate component implementation
  - Ensured 'use client' directive is correctly placed at the top of the file
  - Cleaned up file structure for better maintainability

### Technical Notes
- Successful build verification after the fix
- No changes to component functionality
