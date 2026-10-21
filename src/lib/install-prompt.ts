import type { GuideKey, InstallPath } from "@/lib/install-environment";

/*
 * Whether to offer installing, as a pure function of what the page knows.
 * The component gathers the facts (events, media queries, storage); this
 * decides, so the rules can be tested without a browser.
 */

export const DISMISS_KEY = "d2d.install.dismissedAt";
export const INSTALLED_KEY = "d2d.install.installed";
export const DISMISS_SUPPRESSION_MS = 30 * 24 * 60 * 60 * 1000;

export type InstallState =
  | { kind: "idle" }
  | { kind: "available" }
  | { kind: "manual"; guide: GuideKey }
  | { kind: "dismissed" }
  | { kind: "installed" };

export type InstallFacts = {
  path: InstallPath;
  /* Chromium only offers the install dialog after beforeinstallprompt fires,
     and only once per event. */
  hasDeferredPrompt: boolean;
  standalone: boolean;
  installedFlag: boolean;
  dismissedAt: number | null;
  now: number;
  /* The member is part-way through recording; an install banner is noise. */
  recording: boolean;
};

export function deriveInstallState(facts: InstallFacts): InstallState {
  if (facts.standalone || facts.installedFlag) return { kind: "installed" };

  if (facts.dismissedAt !== null && facts.now - facts.dismissedAt < DISMISS_SUPPRESSION_MS) {
    return { kind: "dismissed" };
  }

  if (facts.recording) return { kind: "idle" };

  switch (facts.path.kind) {
    case "event":
      return facts.hasDeferredPrompt ? { kind: "available" } : { kind: "idle" };
    case "guide":
      return { kind: "manual", guide: facts.path.guide };
    case "none":
      return { kind: "idle" };
  }
}

/* Safari's own flag, or the display-mode every other browser reports. */
export function isStandalone(
  matchMedia: (query: string) => { matches: boolean },
  navigatorStandalone: boolean | undefined,
): boolean {
  return matchMedia("(display-mode: standalone)").matches || navigatorStandalone === true;
}

/*
 * A floating banner covers whatever scrolls under it, so it floats above the
 * nav only while it is small and nothing else is docked there. Past a
 * quarter of the screen (large text) it and the nav left the page under
 * half of it; over a docked Save it hid the screen's main action. Otherwise
 * it sits at the end of the page and scrolls with it.
 */
export const FLOAT_LIMIT = 0.25;

export function bannerFloats(facts: { height: number; screen: number; docked: boolean }): boolean {
  return !facts.docked && facts.height <= facts.screen * FLOAT_LIMIT;
}

/* The recording form lives under /blocks; its Save button sits right where the
   banner would. */
export function isRecordingRoute(pathname: string): boolean {
  return pathname === "/blocks" || pathname.startsWith("/blocks/");
}

/*
 * Storage can be absent (private mode, blocked cookies) or throw when full.
 * Failing to remember a dismissal must never break the page, so every access
 * is guarded and a failure reads as "nothing stored".
 */

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readDismissedAt(storage: StorageLike): number | null {
  try {
    const raw = storage.getItem(DISMISS_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeDismissedAt(storage: StorageLike, now: number): void {
  try {
    storage.setItem(DISMISS_KEY, String(now));
  } catch {
    // Nothing to do: the banner may reappear next visit.
  }
}

export function readInstalled(storage: StorageLike): boolean {
  try {
    return storage.getItem(INSTALLED_KEY) === "1";
  } catch {
    return false;
  }
}

/* A real install prompt means the browser thinks the app is not installed, so
   an earlier "installed" note is stale - the member has since removed it. */
export function clearInstalled(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(INSTALLED_KEY);
  } catch {
    // The flag stays; the banner may be missed until it is cleared.
  }
}

export function writeInstalled(storage: StorageLike): void {
  try {
    storage.setItem(INSTALLED_KEY, "1");
  } catch {
    // Standalone detection still hides the banner inside the installed app.
  }
}
