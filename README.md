# Step Project

A full-stack Next.js application with MongoDB Atlas integration, designed for deployment on Vercel. This project demonstrates a simple "Hello World" application with proper database integration, TypeScript support, and modern front-end design.

## 📋 Table of Contents

- [Project Overview](#project-overview)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [Local Development](#local-development)
- [MongoDB Atlas Setup](#mongodb-atlas-setup)
- [Deployment to Vercel](#deployment-to-vercel)
- [Contributing Guidelines](#contributing-guidelines)
- [Common Issues & Solutions](#common-issues--solutions)
- [Lessons Learned](#lessons-learned)

## 🚀 Project Overview

Step is a minimalistic Next.js application that demonstrates:

- **Full-Stack Development**: Next.js for frontend and API routes
- **Database Integration**: MongoDB Atlas for data storage
- **TypeScript**: Type-safe development experience
- **Modern UI**: Tailwind CSS for styling
- **Deployment**: Vercel for hosting

The application displays a "Hello World" message retrieved from MongoDB Atlas, showcasing the complete integration between frontend, backend, and database.

### Tech Stack

- **Frontend**: Next.js 15, React, Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: MongoDB Atlas
- **Language**: TypeScript
- **Deployment**: Vercel
- **Version Control**: Git, GitHub

## 🔧 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: v18.x or higher (v23.x recommended)
- **npm**: v9.x or higher
- **Git**: For version control
- **MongoDB Atlas Account**: For database access
- **Vercel Account**: For deployment (optional)

## 📥 Installation & Setup

### 1. Clone the Repository

```bash
git clone https://github.com/moldovancsaba/step.git
cd step
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Configuration

Create a `.env.local` file in the root directory with the following variables:

```
# MongoDB Atlas Connection String
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority

# Database Name
MONGODB_DB=step-db

# NextAuth Configuration (if using auth)
NEXTAUTH_SECRET=<your-secret>
NEXTAUTH_URL=http://localhost:3000

# Environment mode
NODE_ENV=development
```

Replace the placeholder values with your actual MongoDB connection string and other configuration.

### 4. Build the Application

```bash
npm run build
```

## 💻 Local Development

### Start the Development Server

```bash
npm run dev
```

This will start the Next.js development server with hot-reloading. By default, the application will be accessible at [http://localhost:3000](http://localhost:3000).

### Project Structure

```
step/
├── .env.local           # Environment variables
├── public/              # Static assets
├── src/
│   ├── app/             # App router components
│   │   ├── api/         # API routes
│   │   │   └── message/ # Message API endpoint
│   │   ├── page.tsx     # Home page component
│   │   └── layout.tsx   # Root layout
│   ├── lib/             # Utility functions
│   │   └── mongodb.ts   # MongoDB connection
│   └── models/          # Database models
│       └── Message.ts   # Message schema
├── package.json         # Project dependencies
└── tsconfig.json        # TypeScript configuration
```

## 🗄️ MongoDB Atlas Setup

### 1. Create a MongoDB Atlas Account

If you don't have an account yet, sign up at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register).

### 2. Create a New Project

- Log in to your MongoDB Atlas account
- Click on "Projects" in the top navigation
- Click "New Project"
- Name your project (e.g., "Step Project")
- Click "Create Project"

### 3. Build a Database

- Click "Build a Database"
- Select the Free tier
- Choose a cloud provider and region
- Click "Create Cluster"

### 4. Create a Database User

- Go to "Database Access" in the left sidebar
- Click "Add New Database User"
- Set username and password (use a strong password)
- Set privileges to "Read and Write to Any Database"
- Click "Add User"

### 5. Configure Network Access

- Go to "Network Access" in the left sidebar
- Click "Add IP Address"
- For development, you can use "Allow Access from Anywhere" (0.0.0.0/0)
- For production, set specific IP addresses

### 6. Get Connection String

- Click "Connect" on your cluster
- Select "Connect your application"
- Copy the connection string
- Replace `<username>`, `<password>`, and `<dbname>` with your credentials and database name
- Add this connection string to your `.env.local` file

## 🌐 Deployment to Vercel

### 1. Push to GitHub

Ensure your code is pushed to a GitHub repository:

```bash
git add .
git commit -m "Ready for deployment"
git push origin main
```

### 2. Connect to Vercel

- Create an account on [Vercel](https://vercel.com) if you don't have one
- Click "Add New..." → "Project"
- Import your GitHub repository
- Configure the project:
  - Framework Preset: Next.js
  - Root Directory: ./
  - Build Command: next build
  - Output Directory: .next

### 3. Environment Variables

Add the same environment variables from your `.env.local` file to Vercel:

- Click on "Environment Variables"
- Add each variable and its value
- Make sure to update `NEXTAUTH_URL` to your Vercel deployment URL

### 4. Deploy

Click "Deploy" and wait for the build to complete. Your application will be deployed to a URL like: `https://your-project-name.vercel.app`.

## 👥 Contributing Guidelines

We welcome contributions to the Step project! Please follow these guidelines to contribute:

### 1. Fork the Repository

Fork the repository to your GitHub account.

### 2. Create a Branch

```bash
git checkout -b feature/your-feature-name
```

### 3. Make Changes

Make your changes and ensure they follow the project's coding standards.

### 4. Test Your Changes

Ensure all tests pass and your changes work as expected:

```bash
npm run build
npm run dev
```

### 5. Submit a Pull Request

- Push your changes to your fork
- Create a pull request to the main repository
- Provide a clear description of your changes

### Coding Standards

- Follow TypeScript best practices
- Use consistent naming conventions
- Write clear, descriptive comments
- Format code with Prettier
- Ensure ESLint validation passes

## 🔍 Common Issues & Solutions

### MongoDB Connection Issues

**Issue**: Error connecting to MongoDB Atlas with "Invalid scheme" error.

**Solution**: Ensure your connection string in `.env.local` starts with `mongodb+srv://` and contains the correct username and password.

```
# Incorrect
MONGODB_URI=your_mongodb_atlas_connection_string

# Correct
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
```

### TypeScript Errors

**Issue**: TypeScript errors with mongoose global type definitions.

**Solution**: Correctly type the global mongoose object:

```typescript
// Incorrect
declare global {
  var mongoose: any;
}

// Correct
interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var mongoose: MongooseCache | undefined;
}

const globalMongoose = global as unknown as {
  mongoose?: MongooseCache;
};
```

### ESLint Errors

**Issue**: ESLint errors about using `var` instead of `let` or `const`.

**Solution**: Use modern JavaScript syntax:

```typescript
// Incorrect
declare global {
  var mongoose: MongooseCache;
}

// Correct
declare global {
  // eslint-disable-next-line no-var
  var mongoose: MongooseCache | undefined;
}
```

### Duplicate Environment Variables

**Issue**: Multiple conflicting environment variables causing connection issues.

**Solution**: Clean up your `.env.local` file to ensure no duplicate entries:

```
# Keep only one definition for each environment variable
MONGODB_URI=mongodb+srv://...
```

## 📚 Lessons Learned

During the development of this project, we encountered and solved several challenges:

1. **TypeScript and MongoDB Integration**: 
   - Properly typing MongoDB connections in a Next.js application requires careful consideration of the global scope.
   - Using proper type declarations helps prevent runtime errors.

2. **Environment Configuration**: 
   - Duplicate or conflicting environment variables can cause subtle bugs.
   - Always validate that your environment variables are correctly loaded.

3. **Mongoose Schema Design**: 
   - Mongoose schemas with custom getters and setters require careful typing in TypeScript.
   - Use `Schema.virtual()` instead of schema property getters for better TypeScript compatibility.

4. **Next.js and API Routes**: 
   - Next.js API routes provide a clean way to create backend endpoints.
   - Proper error handling in API routes is essential for debugging and user experience.

5. **Global State Management**: 
   - Managing database connections as global state requires special handling in Next.js.
   - Connection pooling is crucial for performance in serverless environments.

6. **ESLint Configuration**: 
   - ESLint rules can help maintain code quality but may need customization.
   - Sometimes it's necessary to disable specific rules with inline comments.

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 📞 Contact

For questions or support, please open an issue on GitHub or contact the maintainers.

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
