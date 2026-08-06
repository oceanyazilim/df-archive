/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output keeps the Docker image small: only the traced runtime
  // files are copied, no node_modules tree.
  output: "standalone",
  poweredByHeader: false,
};

module.exports = nextConfig;
