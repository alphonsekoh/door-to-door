"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/*
 * The history and records search term, which the screen holds and the URL
 * never carries (D-129-7): it is a name or a phone number, and a query string
 * reaches the server's logs, the phone's history and a sign-in's callbackUrl.
 *
 * A link from before that, still carrying `?q=`, fills the search, and the
 * address drops the term at once without a reload (#163). `path` and `search`
 * are the screen and the filters it keeps.
 */
export function useSearchTerm(
  path: string,
  search: string,
): readonly [string, (q: string) => void] {
  const router = useRouter();
  const linked = useSearchParams().get("q");
  const [q, setQ] = useState(linked ?? "");
  /* Back or Forward onto an old entry changes the address under a screen
     that stays mounted, so the term is taken whenever a new one appears. */
  const [taken, setTaken] = useState(linked);
  if (linked !== taken) {
    setTaken(linked);
    if (linked !== null) setQ(linked);
  }

  const href = search === "" ? path : `${path}?${search}`;
  useEffect(() => {
    /* Nobody asked to move, so the page is not scrolled back to the top. */
    if (linked !== null) router.replace(href, { scroll: false });
  }, [linked, href, router]);

  return [q, setQ];
}
