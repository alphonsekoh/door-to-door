"use client";

import { useEffect } from "react";

/*
 * iOS Safari applies :active only while some touchstart listener exists, so
 * without this every press state in globals.css shows on Android and never on
 * an iPhone. Passive and empty: it changes nothing about scrolling or taps.
 */
export function PressFeedback() {
  useEffect(() => {
    const listen = () => undefined;
    document.addEventListener("touchstart", listen, { passive: true });
    return () => {
      document.removeEventListener("touchstart", listen);
    };
  }, []);
  return null;
}
