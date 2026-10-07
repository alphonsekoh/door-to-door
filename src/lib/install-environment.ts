/*
 * Which browser and OS the member is on, and what installing looks like there.
 *
 * Installing is not one thing. Chromium on Android announces it with an event;
 * Firefox on Android and every browser on iOS have no event and need the member
 * to use a menu; in-app browsers (Facebook, Instagram, Line) cannot install at
 * all. Guessing wrong shows instructions for a button that is not there, so an
 * unrecognised browser gets no banner rather than a plausible-looking one.
 */

export type Os = "ios" | "android" | "other";
export type Family = "safari" | "chromium" | "firefox" | "webview" | "unknown";

export type BrowserProfile = {
  os: Os;
  family: Family;
  /* major * 100 + minor, so 16.4 is 1604; null when the UA does not say. */
  iosVersion: number | null;
};

export type GuideKey =
  "ios-safari" | "ios-other-browser" | "ios-open-in-safari" | "android-firefox" | "open-in-browser";

export type InstallPath = { kind: "event" } | { kind: "guide"; guide: GuideKey } | { kind: "none" };

/* Every wording the member can be shown, in one place so a correction is a
   one-line change. */
export const INSTALL_GUIDES: Record<GuideKey, { title: string; steps: string }> = {
  "ios-safari": {
    title: "Install Door to Door",
    steps: "Tap the Share button, then choose Add to Home Screen.",
  },
  "ios-other-browser": {
    title: "Install Door to Door",
    steps: "Open this browser's Share button or menu, then choose Add to Home Screen.",
  },
  "ios-open-in-safari": {
    title: "Install Door to Door",
    steps: "Open this page in Safari, tap Share, then choose Add to Home Screen.",
  },
  "android-firefox": {
    title: "Install Door to Door",
    steps: "Open the browser menu, then choose Install or Add to Home screen.",
  },
  "open-in-browser": {
    title: "Install Door to Door",
    steps: "Open this page in your phone's browser to install it.",
  },
};

/* Third-party browsers on iOS gained Add to Home Screen in 16.4. */
const IOS_OTHER_BROWSER_MIN = 1604;

const WEBVIEW_TOKENS = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|Twitter|; wv\)/;

function iosVersionOf(ua: string): number | null {
  const match = /OS (\d+)[_.](\d+)/.exec(ua) ?? /Version\/(\d+)\.(\d+)/.exec(ua);
  if (match === null) return null;
  return Number(match[1]) * 100 + Number(match[2]);
}

function isIpadInDesktopMode(ua: string, maxTouchPoints: number): boolean {
  return ua.includes("Macintosh") && maxTouchPoints > 1;
}

export function classifyBrowser(ua: string, maxTouchPoints = 0): BrowserProfile {
  const ios = /iPhone|iPad|iPod/.test(ua) || isIpadInDesktopMode(ua, maxTouchPoints);
  const android = ua.includes("Android");

  if (ios) {
    const iosVersion = iosVersionOf(ua);
    // A WebKit UA without "Safari/" is a web view embedded in some app.
    if (WEBVIEW_TOKENS.test(ua) || !ua.includes("Safari/")) {
      return { os: "ios", family: "webview", iosVersion };
    }
    if (ua.includes("FxiOS")) return { os: "ios", family: "firefox", iosVersion };
    if (/CriOS|EdgiOS|OPiOS|OPT\//.test(ua)) return { os: "ios", family: "chromium", iosVersion };
    return { os: "ios", family: "safari", iosVersion };
  }

  const os: Os = android ? "android" : "other";
  if (WEBVIEW_TOKENS.test(ua)) return { os, family: "webview", iosVersion: null };
  if (ua.includes("Firefox/")) return { os, family: "firefox", iosVersion: null };
  if (ua.includes("Chrome/")) return { os, family: "chromium", iosVersion: null };
  return { os, family: "unknown", iosVersion: null };
}

export function installPathFor(profile: BrowserProfile): InstallPath {
  if (profile.family === "webview") return { kind: "guide", guide: "open-in-browser" };

  if (profile.os === "ios") {
    if (profile.family === "safari") return { kind: "guide", guide: "ios-safari" };
    const canAddFromOtherBrowser =
      profile.iosVersion !== null && profile.iosVersion >= IOS_OTHER_BROWSER_MIN;
    return {
      kind: "guide",
      guide: canAddFromOtherBrowser ? "ios-other-browser" : "ios-open-in-safari",
    };
  }

  if (profile.family === "chromium") return { kind: "event" };
  if (profile.os === "android" && profile.family === "firefox") {
    return { kind: "guide", guide: "android-firefox" };
  }
  return { kind: "none" };
}
