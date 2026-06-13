/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@step/api-client", "@step/shared-types"],
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
};
export default nextConfig;
