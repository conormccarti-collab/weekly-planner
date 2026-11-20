import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Every route here is per-user and auth-gated (cookies/session on every
  // request), so Cache Components' static-shell optimization has nothing
  // to offer and just forces Suspense boundaries everywhere for no benefit.
  turbopack: {
    // Pin the root so Turbopack doesn't go looking at an unrelated
    // package-lock.json in the parent (home) directory.
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
