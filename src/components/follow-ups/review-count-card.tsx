"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FollowUpList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";

type State = { status: "loading" } | { status: "ready"; total: number } | { status: "error" };

/*
 * How many suggestions wait for an admin, on the admin landing page. The
 * count is the list's own total, one row asked for. Hidden at zero, and a
 * failed load is a line, never in the way of the sessions below.
 */
export function ReviewCountCard() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    apiFetch<FollowUpList>("/follow-ups?status=suggested&limit=1").then(
      (page) => {
        setState({ status: "ready", total: page.pagination.total });
      },
      () => {
        setState({ status: "error" });
      },
    );
  }, []);

  if (state.status === "loading") return null;

  if (state.status === "error") {
    return <p className="text-caption text-foreground-muted">Could not check for suggestions.</p>;
  }

  if (state.total === 0) return null;

  return (
    <section
      aria-label="Suggestions to review"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-primary/50 bg-primary/10 p-4"
    >
      <h2 className="min-w-0 flex-[1_1_12ch] text-body font-semibold">
        {state.total === 1
          ? "1 suggestion to review"
          : `${String(state.total)} suggestions to review`}
      </h2>
      <Link
        href="/admin/follow-ups?tab=review"
        className="inline-flex min-h-11 btn-primary items-center rounded-lg px-4 text-body font-medium"
      >
        Review
      </Link>
    </section>
  );
}
