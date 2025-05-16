/** @type {import('next').NextConfig} */

const nextConfig = {
  // Configure your Next.js settings
  reactStrictMode: true,
  
  // Ensure we output source maps in production
  productionBrowserSourceMaps: true,
  
  // Configure environment variables
  env: {
    // Making the MongoDB URI available to the client (only public parts)
    MONGODB_HOST: process.env.MONGODB_URI 
      ? new URL(process.env.MONGODB_URI).hostname 
      : 'mongodb-server',
    
    // App environment
    NODE_ENV: process.env.NODE_ENV || 'development',
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
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors - use only for testing
    // !! WARN !!
    ignoreBuildErrors: process.env.NODE_ENV === 'development',
  },
  
  // Images configuration
  images: {
    domains: ['images.unsplash.com'],
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
};

module.exports = nextConfig;
