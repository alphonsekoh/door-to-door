"use client";

import { useLinkStatus } from "next/link";

/*
 * Inside a <Link>: tints it and shows a small spinner while the route it
 * opens is still on its way, so a tap in a dead spot is answered at once
 * rather than after the network. Always rendered and only faded in, so it
 * moves nothing. Its parent must be `relative`.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      data-pending={pending}
      className={`pointer-events-none absolute inset-0 flex items-center justify-end rounded-[inherit] bg-surface-muted/70 pr-4 transition-opacity ${
        pending ? "opacity-100" : "opacity-0"
      }`}
    >
      <span className="size-5 animate-spin rounded-full border-2 border-border-strong border-t-primary" />
    </span>
  );
}
