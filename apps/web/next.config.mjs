/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@step/api-client", "@step/shared-types"],
  // Standalone output for lean container images (see apps/Dockerfile.web).
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
};
export default nextConfig;
