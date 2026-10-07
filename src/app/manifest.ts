import type { MetadataRoute } from "next";

/* Colours match the light theme in layout.tsx's viewport; the splash screen
   is painted from these before any CSS loads. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Door to Door",
    short_name: "Door to Door",
    description: "Record door-to-door visits and follow up on them later.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
