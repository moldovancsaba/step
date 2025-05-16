/** @type {import('next').NextConfig} */

const nextConfig = {
  // Configure your Next.js settings
  reactStrictMode: true,
  
  // Ensure we output source maps in production
  productionBrowserSourceMaps: true,
  
  // Configure environment variables - only expose what's needed to the client
  env: {
    // Making the MongoDB URI available to the client (only public parts)
    MONGODB_HOST: process.env.MONGODB_URI 
      ? new URL(process.env.MONGODB_URI).hostname 
      : 'mongodb-server',
  },
  
  // Configure webpack
  webpack: (config, { isServer }) => {
    // Fixes npm packages that depend on mongoose/mongodb
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
      };
    }
    
    return config;
  },
  
  // Handle transpilation for TypeScript
  typescript: {
    // !! WARN !!
    // Dangerously allow production builds to complete even with type errors
    // This helps with CI/CD but should be avoided in general
    // !! WARN !!
    ignoreBuildErrors: false, // Set to true only if needed for deployment
  },
  
  // Images configuration - add OpenStreetMap domains
  images: {
    domains: [
      'images.unsplash.com',
      'a.tile.openstreetmap.org',
      'b.tile.openstreetmap.org',
      'c.tile.openstreetmap.org',
      'tile.openstreetmap.org',
      'www.openstreetmap.org'
    ],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.openstreetmap.org',
        pathname: '**',
      }
    ],
  },
  
  // Use SWC minification
  swcMinify: true,
  
  // Configure headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
        ],
      },
    ];
  },
  
  // Optimize build output
  output: 'standalone',
  
  // Optimize for production
  compiler: {
    // Remove console.log in production
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },
};

module.exports = nextConfig;
