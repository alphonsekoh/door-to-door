import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";
import { PROXY_BODY_LIMIT_BYTES } from "./src/server/http/body-limit";
import { LOOPBACK_HOSTS } from "./src/server/http/dev-hosts";
import { securityHeaders } from "./src/server/http/security-headers";

const nextConfig: NextConfig = {
  // The floating dev badge overlaps the bottom nav on mobile viewports.
  devIndicators: false,
  poweredByHeader: false,
  // Next's own dev endpoints answer only these Origins; the proxy holds every
  // other path to the same list by Host (#124). Ignored by a production build.
  allowedDevOrigins: [...LOOPBACK_HOSTS],
  // Emits a self-contained server bundle for the Docker runner stage.
  output: "standalone",
  // Nothing uses next/image, and /_next/image would otherwise fetch and decode
  // images for anyone who asks: with this set it answers 404 (#118).
  images: { unoptimized: true },
  // Next buffers each body the proxy sees, 10 MB by default; past this it
  // truncates what the handler reads rather than refusing the request (#120).
  // Above every contract cap, so a cut body is still refused 413 (#126).
  experimental: { proxyClientMaxBodySize: PROXY_BODY_LIMIT_BYTES },
  async headers() {
    return [
      {
        // Every response, including those the proxy writes and the PWA paths
        // it skips. NODE_ENV is the build mode, not a setting.
        source: "/(.*)",
        headers: securityHeaders({ development: process.env.NODE_ENV === "development" }),
      },
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
