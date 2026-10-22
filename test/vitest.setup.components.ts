import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach } from "vitest";

/* Sheets still leave through AnimatePresence, a frame later, but no test
   waits out a spring. Tests about the motion itself set what they need. */
MotionGlobalConfig.skipAnimations = true;

/* jsdom lays nothing out, so it has no scrollIntoView; sheets call it when a
   field takes focus. Tests that care spy on it. */
Element.prototype.scrollIntoView = function scrollIntoView() {
  return undefined;
};

afterEach(() => {
  cleanup();
});
