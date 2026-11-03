import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

const nextConfig: NextConfig = {
  // The floating dev badge overlaps the bottom nav on mobile viewports.
  devIndicators: false,
  // Emits a self-contained server bundle for the Docker runner stage.
  output: "standalone",
  // Nothing uses next/image, and /_next/image would otherwise fetch and decode
  // images for anyone who asks: with this set it answers 404 (#118).
  images: { unoptimized: true },
  async headers() {
    return [
      {
        // A cached worker script is how a bad deploy never gets fixed: the
        // browser would keep running the old one.
        source: "/serwist/:path*",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default withSerwist(nextConfig);
