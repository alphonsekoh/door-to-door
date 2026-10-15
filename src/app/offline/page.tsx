import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { ReloadWhenOnline } from "@/components/reload-when-online";

export const metadata: Metadata = { title: "Offline" };

/* Precached by the service worker and shown when a page cannot be fetched.
   Static on purpose: it carries nothing about the signed-in member. The retry
   is a plain form submit so it is a real page load, which is what actually
   tests the connection; signal coming back does the same by itself. */
export default function OfflinePage() {
  return (
    <>
      <PageHeader
        title="You're offline"
        subtitle="This screen needs a connection. Check your signal and try again."
      />
      <p className="mb-4 text-body">
        Visits already saved on this phone are kept. They send once your signal is back.
      </p>
      <ReloadWhenOnline />
      <form action="/" method="get">
        <button
          type="submit"
          className="min-h-12 rounded-xl bg-primary px-6 text-body font-semibold text-primary-foreground"
        >
          Try again
        </button>
      </form>
    </>
  );
}
