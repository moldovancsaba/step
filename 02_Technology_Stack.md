# Technology Stack
## Purpose

This document outlines the core technologies, libraries, tools, and environment requirements for the actual project. It serves as a central reference for maintainers and contributors.

## Core Technologies

### Frontend

* **Framework:** Next.js v15.2.4
* **Language:** TypeScript (Strict Mode)
* **UI Library:** React v19.0.0
* **State Management:** Zustand
* **Styling:** Tailwind CSS

### Backend

* **Runtime:** Node.js v18+
* **Database:** MongoDB (Atlas cluster or local instance)
* **ODM (Object Document Mapper):** Mongoose
* **API Layer:** Express.js (TypeScript)

### Testing

* **Test Runner:** Jest (with ts-jest)
* **Testing Libraries:** React Testing Library, Cypress Component Testing
* **Protocol:** Chromatic for UI visual testing

### Authentication (If Implemented)

* **Library:** 
* **Provider:** Google OAuth 2.0 

## Deployment & Infrastructure

* **Platform:** Vercel (Production environment)
* **Version Control:** Git (Repository hosted on Github)

## Development Tools & Environment

* **Package Manager:** npm
* **Code Editor:** VS Code (with ESLint/Prettier extensions)
* **Linting/Formatting:** ESLint + Airbnb config, Prettier
* **Database GUI:** MongoDB Compass (Optional)
* **Terminal:** Warp.dev (User preference)

## Environment Requirements

* **Operating System:** macOS

## Key Libraries (Examples from previous iteration - confirm current usage)

* `mongoose`: For MongoDB interaction

*(This list must be kept updated as dependencies are added or removed. This document is the definitive source.)*