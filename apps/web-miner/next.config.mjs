/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@step/proof-protocol", "@step/shared-types"],
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
};
export default nextConfig;
