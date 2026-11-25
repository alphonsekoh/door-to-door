"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ErasureRequestList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";

/*
 * How many requests to erase data wait for an admin (#279), on the admin
 * landing page as the people waiting for approval are. Read once; hidden at
 * zero, and when it could not be read: Erasure requests says so in place.
 */
export function ErasureCountCard() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let current = true;
    apiFetch<ErasureRequestList>("/erasure-requests?status=open&limit=1").then(
      (page) => {
        if (current) setCount(page.pagination.total);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);

  if (count === null || count === 0) return null;

  return (
    <section
      aria-label="Erasure requests"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-primary/50 bg-primary/10 p-4"
    >
      <h2 className="min-w-0 flex-[1_1_12ch] text-body font-semibold">
        {count === 1 ? "1 erasure request waiting" : `${String(count)} erasure requests waiting`}
      </h2>
      <Link
        href="/admin/privacy"
        className="inline-flex min-h-11 btn-primary items-center rounded-lg px-4 text-body font-medium"
      >
        Review
      </Link>
    </section>
  );
}
