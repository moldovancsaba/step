# Triangle Mesh Visualization Project

## Current State (Base Implementation)
A Three.js-based visualization of a triangular mesh with geolocation integration. This implementation serves as the foundation for future development.

### Core Features
1. **Mesh Visualization**
   - Display of triangular mesh from geographic coordinates
   - Black wireframe rendering (1px line width)
   - Light grey background
   - No pan/zoom/rotation (static view)

2. **Triangle Selection**
   - Click interaction to select triangles
   - Selected triangles highlighted in red
   - Visual feedback on hover (pointer cursor)

3. **Geolocation Integration**
   - Real-time user location tracking
   - Blue dot indicating user's position relative to the mesh
   - Continuous location updates
   - Display of coordinates with 6 decimal precision

### Technical Implementation
- **Framework**: Next.js 15.3.2 with TypeScript
- **3D Rendering**: Three.js
- **Styling**: Tailwind CSS with shadcn/ui components
- **Data Structure**: Triangle mesh with geographic coordinates

### Project Structure
```
src/
├── app/
│   └── page.tsx              # Main application page
├── components/
│   ├── MeshRenderer/
│   │   ├── Scene.ts         # Three.js scene management
│   │   └── index.tsx        # React component wrapper
│   └── ui/                  # shadcn/ui components
├── lib/
│   └── geometry.ts          # Geometry utilities
├── types/
│   ├── geometry.ts          # Type definitions for mesh
│   └── viewport.ts          # Type definitions for viewport
└── utils/
    └── math.ts             # Math utility functions
```

### Data Format
The mesh data is stored in `public/triangle_base_coordinates_22.json` with the following structure:
```typescript
interface TriangleMesh {
  id: string;
  coordinates: [number, number][]; // [longitude, latitude][]
}
```

### Setup Instructions
1. Clone the repository
```bash
git clone https://github.com/moldovancsaba/step.git
cd step
```

2. Install dependencies
```bash
npm install
```

3. Create a `.env.local` file with required environment variables
```env
NEXT_PUBLIC_MAPBOX_TOKEN=your_mapbox_token_here
```

4. Run the development server
```bash
npm run dev
```

### Development Status
This implementation serves as the baseline for future features:
- [x] Basic mesh rendering
- [x] Triangle selection
- [x] Geolocation integration
- [ ] Mesh manipulation
- [ ] Advanced visualization options
- [ ] Data persistence
- [ ] User authentication
- [ ] Mobile optimization

### Next Steps
1. Implement mesh manipulation features
2. Add zoom and pan controls
3. Develop data persistence layer
4. Enhance mobile experience
5. Add unit and integration tests

## License
MIT

