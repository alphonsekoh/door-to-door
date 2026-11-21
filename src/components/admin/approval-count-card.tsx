"use client";

import Link from "next/link";
import { useApprovalCount } from "@/lib/session/approval-count";

/*
 * How many people wait for an admin's approval, on the admin landing page
 * (#249), as the suggestions waiting for review are. The Admin tab's count,
 * read once a page load; hidden at zero, and when it could not be read: the
 * Team screen says so in place.
 */
export function ApprovalCountCard() {
  const count = useApprovalCount(true);
  if (count === null || count === 0) return null;

  return (
    <section
      aria-label="Waiting for approval"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-primary/50 bg-primary/10 p-4"
    >
      <h2 className="min-w-0 flex-[1_1_12ch] text-body font-semibold">
        {count === 1
          ? "1 person waiting for approval"
          : `${String(count)} people waiting for approval`}
      </h2>
      <Link
        href="/admin/team"
        className="inline-flex min-h-11 btn-primary items-center rounded-lg px-4 text-body font-medium"
      >
        Review
      </Link>
    </section>
  );
}
