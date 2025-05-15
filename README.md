# STEP - Super Triangular Earth Project

## Overview


Its core purpose is to create an interactive 2D world map based on an triangles.

1. Given a set of 12 points with vertices of a regular icosahedron on a 2D map.  
2. Use the coordinates of cartographic degrees to determine the “exact” location of the points. It can be arbitrarily distorted and replaced with the nearest accurately definable value for points where the calculated values do not match the accuracy of the cartographic points. 
3. The North Pole 90.00000,0.00000 and the South Pole -90.00000,0.00000 are one of the named peaks of our body. 
4. The points are the coordinates of the triangles drawn between the points, so the surfaces of the icosahedron and the triangles will always cover the world map. 
5. According to some rules, the triangles that make up the surface of the world are decomposed into 4 “equal” triangles such that points 3 of the side bisector of the dissolving triangle, and the three vertices of the dissolving triangle give the vertices of the four new triangles. The coordinate value of the page halves will be determined with the same “accuracy” as the vertices. 
6. The map can be zoomed and moved around like any map with the mouse, and all its faces (triangles) can be clicked. 
7. The basic triangles at the beginning are snow white, and the background is 10% grey. All phase and colour 50% transparent 
8. Clicking on any triangle will turn that triangle into 10% grey, then click 2nd 20% grey, third click 30%, and so on, up to 100%. 
9. After the 11th click, the spherical triangle divides into four equal triangles into smaller triangles; the four triangles thus displayed will be snow white. 
10. According to the previous method, The new triangle will turn 10% grey on the first click and 20% on the 2nd click. This is because the 10th Click breaks into four triangles on the 11th Click. 
11. This division process can occur through 19 levels, with the last click on the last level turning the triangle red.


The "Done is Better than Perfect" philosophy guides the incremental delivery of functional value.

### Technical Architecture

STEP is built with a modern, scalable architecture:

- **Frontend:**
  - Next.js v15.2.4 with App Router
  - React v19.0.0 for component-based UI
  - TypeScript with strict mode for type safety
  - Zustand for state management
  - Tailwind CSS for styling

- **Backend:**
  - Node.js v18+ runtime
  - Express.js (TypeScript) for API layer
  - MongoDB for data persistence
  - Mongoose as ODM for database interaction

- **2D Geometry:**
  - Point mapping and triangle division algorithms
  - OpenStreetMap integration

The specific features and priorities for the current development iteration are defined in `01_Roadmap.md`.

## Technology Stack

The project utilizes the following technologies, detailed further in `02_Technology_Stack.md`.

## Getting Started

### Prerequisites

- Node.js v18 or later
- npm v8 or later
- MongoDB v7.x (local installation or Atlas account)
- Git

### Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/moldovancsaba/step.git
   cd /Users/moldovan/Projects/step
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **MongoDB Setup:**
   - **Local Development:**
     ```bash
     # Start MongoDB service (macOS)
     brew services start mongodb-community@7.0
     
     # Create database
     mongosh
     > use step
     > db.createCollection('triangles')
     > exit
     ```
   
   - **Configure environment variables:**
     Create a `.env.local` file in the project root:
     ```
     # Local MongoDB
     MONGODB_URI=mongodb://localhost:27017/step
     
     # Or for MongoDB Atlas
     # MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/step?retryWrites=true&w=majority
     
     # Other environment variables
     NODE_ENV=development
     ```

4. **Run the development server:**
   ```bash
   # Start the Next.js development server
   npm run dev
   
   # Start with full stack support (API and db migrations)
   npm run dev:fullstack
   ```

5. **Access the application:**
   Open [http://localhost:3000](http://localhost:3000) in your browser


## Development Process


Any AI assisting development must consult these rules, especially `07_AI_Knowledge_Rules.md`, before starting tasks.

Contributing

Contributions are accepted. Contributors must follow rules in `05_Definition_of_Done.md`.

License

All code and intellectual property belong to `MOLDOVAN CSABA moldovancsaba@gmail.com`.

The software code is released under The Unlicense (public domain dedication): This is free and unencumbered software released into the public domain. Anyone is free to copy, modify, publish, use, compile, sell, or distribute this software, either in source code form or as a compiled binary, for any purpose, commercial or non-commercial, and by any means. In jurisdictions that recognize copyright laws, the author or authors of this software dedicate any and all copyright interest in the software to the public domain. We make this dedication for the benefit of the public at large and to the detriment of our heirs and successors. We intend this dedication to be an overt act of relinquishment in perpetuity of all present and future rights to this software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to `http://unlicense.org/ `