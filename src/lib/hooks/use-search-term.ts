"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useState } from "react";

/*
 * The history and records search term, which the screen holds and the URL
 * never carries (D-129-7): it is a name or a phone number, and a query string
 * reaches the server's logs, the phone's history and a sign-in's callbackUrl.
 *
 * A link from before that, still carrying `?q=`, fills the search, and the
 * address drops the term at once (#163). `path` and `search` are the screen
 * and the filters it keeps.
 */
export function useSearchTerm(
  path: string,
  search: string,
): readonly [string, (q: string) => void] {
  const linked = useSearchParams().get("q");
  const [q, setQ] = useState(linked ?? "");
  /* Back or Forward onto an old entry changes the address under a screen
     that stays mounted, so the term is taken whenever a new one appears. */
  const [taken, setTaken] = useState(linked);
  if (linked !== taken) {
    setTaken(linked);
    if (linked !== null) setQ(linked);
  }

  /*
   * The History API, not router.replace, which waits on a server round trip
   * with the term still in the address and in every Referer, and reloads the
   * page, search emptied, if that round trip fails.
   */
  const href = search === "" ? path : `${path}?${search}`;
  useLayoutEffect(() => {
    /* Before this screen sends a request. Next's state in the entry is kept by
       hand: its own replaceState, which keeps it, may not be installed yet. */
    if (linked !== null) window.history.replaceState(window.history.state, "", href);
  }, [linked, href]);
  useEffect(() => {
    if (linked === null) return;
    /* Next's replaceState is what tells useSearchParams. The router installs
       it in an effect, and an ancestor's effects run after this screen's. */
    const tell = setTimeout(() => {
      window.history.replaceState(null, "", href);
    });
    return () => {
      clearTimeout(tell);
    };
  }, [linked, href]);

  return [q, setQ];
}
