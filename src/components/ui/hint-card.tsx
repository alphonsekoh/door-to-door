"use client";

import type { ReactNode } from "react";
import { WholeWords } from "@/components/ui/unit-number";
import { useHint } from "@/lib/hooks/use-hint";

/*
 * A first-use explanation, dismissed for good on this phone with Got it.
 * Nothing is drawn until the phone has been asked, so it never flashes up
 * for someone who has already read it.
 */
export function HintCard({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const { show, dismiss } = useHint(id);
  if (!show) return null;
  return (
    <section aria-label={title} className="rounded-xl border border-primary/40 bg-primary/5 p-4">
      <p className="text-body font-semibold">
        <WholeWords text={title} />
      </p>
      <div className="mt-1 text-body text-foreground-muted">{children}</div>
      <button
        type="button"
        onClick={dismiss}
        className="mt-1 min-h-11 min-w-11 font-medium btn-text"
      >
        Got it
      </button>
    </section>
  );
}
