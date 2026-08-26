import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev badge overlaps the bottom nav on mobile viewports.
  devIndicators: false,
  // Emits a self-contained server bundle for the Docker runner stage.
  output: "standalone",
};

export default nextConfig;
