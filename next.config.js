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
  webpack(config) {
    // Serve the 3D brand asset (src/assets/Ocean-3D-LOGO.glb) as a resolved
    // URL at build time, the Next.js/webpack equivalent of Vite's `?url`
    // imports — the file stays under src/assets/, nothing moves to public/.
    config.module.rules.push({
      test: /\.glb$/,
      type: "asset/resource",
    });
    return config;
  },
};

module.exports = nextConfig;
