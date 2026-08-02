/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output produces a minimal server bundle for Docker deployment.
  output: "standalone",
  // The mapping file is read at runtime via fs from process.cwd().
  experimental: {
    // Ensure the json mapping is available to the standalone server trace.
    outputFileTracingIncludes: {
      "/api/**": ["./json/**"],
    },
  },
};

module.exports = nextConfig;
