"use client";

import { useEffect } from "react";

/*
 * The offline page has no member, so no queue runs on it: visits saved before
 * it was shown would wait for a tap on Try again. Signal coming back loads
 * the page the member was after, which starts their queue (D-33-1). Where the
 * offline page is itself the address, that is the home screen.
 */
export function ReloadWhenOnline() {
  useEffect(() => {
    const reload = () => {
      if (window.location.pathname === "/offline") window.location.replace("/");
      else window.location.reload();
    };
    window.addEventListener("online", reload);
    return () => {
      window.removeEventListener("online", reload);
    };
  }, []);
  return null;
}
