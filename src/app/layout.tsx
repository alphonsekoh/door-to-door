import type { Metadata, Viewport } from "next";
import { SessionProvider } from "next-auth/react";
import { AppShell } from "@/components/shell/app-shell";
import { PwaProvider } from "@/components/pwa/pwa-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Door to Door",
    template: "%s · Door to Door",
  },
  description: "Record door-to-door visits and follow up on them later.",
  applicationName: "Door to Door",
  icons: { apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Door to Door", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /* Zoom stays available - capping it at 1 would fail WCAG 1.4.4. */
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#141719" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <PwaProvider>
          <SessionProvider>
            <AppShell>{children}</AppShell>
          </SessionProvider>
        </PwaProvider>
      </body>
    </html>
  );
}
