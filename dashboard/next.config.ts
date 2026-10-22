import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keeps the dev badge out of screen recordings of the demo.
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    // The dashboard is a standalone pnpm project; without this, lockfiles in parent folders confuse root detection.
    root: path.resolve(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
