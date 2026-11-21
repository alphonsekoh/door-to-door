"use client";

import { useCallback, useState } from "react";

/*
 * A screen's filters, tab or view, which live in the address, shown as last
 * chosen.
 *
 * A choice goes to the address through the History API, not router.replace:
 * that waited on a server round trip the page has no use for, the field
 * showing its old value until the server answered, and a second choice made
 * meanwhile was built on stale filters and dropped the first (#245). With no
 * signal it fell back to a page load, which the worker answers with Offline.
 * Next's own replaceState tells useSearchParams a render later, so the choice
 * is held here until then. An address that changes any other way - Back,
 * Forward, a link - is taken as it comes.
 *
 * `linked` is the filters the address holds, written as the screen writes
 * them, so the router reporting a choice back changes nothing.
 */
export function useAddressFilters(
  path: string,
  linked: string,
): readonly [string, (search: string) => void] {
  const [search, setSearch] = useState(linked);
  const [taken, setTaken] = useState(linked);
  if (linked !== taken) {
    setTaken(linked);
    setSearch(linked);
  }

  const choose = useCallback(
    (next: string) => {
      setSearch(next);
      /* Without Next's state: its replaceState puts that back, and moves
         useSearchParams only for a call that does not carry it (R-141). */
      window.history.replaceState(null, "", next === "" ? path : `${path}?${next}`);
    },
    [path],
  );

  return [search, choose];
}
