import { describe, expect, it } from "vitest";
import {
  classifyBrowser,
  INSTALL_GUIDES,
  installPathFor,
  type BrowserProfile,
  type InstallPath,
} from "@/lib/install-environment";

const UA = {
  androidChrome:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
  androidEdge:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36 EdgA/118.0.2088.66",
  androidOpera:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36 OPR/76.2.4027.73374",
  androidFirefox: "Mozilla/5.0 (Android 13; Mobile; rv:118.0) Gecko/118.0 Firefox/118.0",
  androidFacebook:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/430.0.0.0;]",
  androidLine:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36 Line/13.0.0",
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/118.0.5993.69 Mobile/15E148 Safari/604.1",
  iosChromeOld:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/118.0.5993.69 Mobile/15E148 Safari/604.1",
  iosFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/118.0 Mobile/15E148 Safari/605.1.15",
  iosEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/118.0.2088.69 Mobile/15E148 Safari/605.1.15",
  iosInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21A329 Instagram 300.0.0.29.110 (iPhone14,5; iOS 17_0; en_US; scale=3.00)",
  iosBareWebview:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  ipadDesktopMode:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
  desktopFirefox:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:118.0) Gecko/20100101 Firefox/118.0",
  desktopSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  mystery: "SomeBrowser/1.0",
};

const event: InstallPath = { kind: "event" };
const guide = (key: Extract<InstallPath, { kind: "guide" }>["guide"]): InstallPath => ({
  kind: "guide",
  guide: key,
});

describe("classifyBrowser and installPathFor", () => {
  const cases: [string, string, number, BrowserProfile, InstallPath][] = [
    [
      "Android Chrome",
      UA.androidChrome,
      5,
      { os: "android", family: "chromium", iosVersion: null },
      event,
    ],
    [
      "Samsung Internet",
      UA.androidSamsung,
      5,
      { os: "android", family: "chromium", iosVersion: null },
      event,
    ],
    [
      "Android Edge",
      UA.androidEdge,
      5,
      { os: "android", family: "chromium", iosVersion: null },
      event,
    ],
    [
      "Android Opera",
      UA.androidOpera,
      5,
      { os: "android", family: "chromium", iosVersion: null },
      event,
    ],
    [
      "Android Firefox",
      UA.androidFirefox,
      5,
      { os: "android", family: "firefox", iosVersion: null },
      guide("android-firefox"),
    ],
    [
      "Facebook on Android",
      UA.androidFacebook,
      5,
      { os: "android", family: "webview", iosVersion: null },
      guide("open-in-browser"),
    ],
    [
      "Line on Android",
      UA.androidLine,
      5,
      { os: "android", family: "webview", iosVersion: null },
      guide("open-in-browser"),
    ],
    [
      "iOS Safari",
      UA.iosSafari,
      5,
      { os: "ios", family: "safari", iosVersion: 1700 },
      guide("ios-safari"),
    ],
    [
      "iOS Chrome 17",
      UA.iosChrome,
      5,
      { os: "ios", family: "chromium", iosVersion: 1700 },
      guide("ios-other-browser"),
    ],
    [
      "iOS Chrome 15",
      UA.iosChromeOld,
      5,
      { os: "ios", family: "chromium", iosVersion: 1507 },
      guide("ios-open-in-safari"),
    ],
    [
      "iOS Firefox",
      UA.iosFirefox,
      5,
      { os: "ios", family: "firefox", iosVersion: 1700 },
      guide("ios-other-browser"),
    ],
    [
      "iOS Edge",
      UA.iosEdge,
      5,
      { os: "ios", family: "chromium", iosVersion: 1700 },
      guide("ios-other-browser"),
    ],
    [
      "Instagram on iOS",
      UA.iosInstagram,
      5,
      { os: "ios", family: "webview", iosVersion: 1700 },
      guide("open-in-browser"),
    ],
    [
      "an iOS web view with no Safari token",
      UA.iosBareWebview,
      5,
      { os: "ios", family: "webview", iosVersion: 1700 },
      guide("open-in-browser"),
    ],
    [
      "iPad in desktop mode",
      UA.ipadDesktopMode,
      5,
      { os: "ios", family: "safari", iosVersion: 1700 },
      guide("ios-safari"),
    ],
    [
      "desktop Chrome",
      UA.desktopChrome,
      0,
      { os: "other", family: "chromium", iosVersion: null },
      event,
    ],
    [
      "desktop Firefox",
      UA.desktopFirefox,
      0,
      { os: "other", family: "firefox", iosVersion: null },
      { kind: "none" },
    ],
    [
      "desktop Safari (a Mac, not an iPad)",
      UA.desktopSafari,
      0,
      { os: "other", family: "unknown", iosVersion: null },
      { kind: "none" },
    ],
    [
      "an unrecognised browser",
      UA.mystery,
      0,
      { os: "other", family: "unknown", iosVersion: null },
      { kind: "none" },
    ],
  ];

  it.each(cases)("%s", (_name, ua, touchPoints, profile, path) => {
    const classified = classifyBrowser(ua, touchPoints);
    expect(classified).toEqual(profile);
    expect(installPathFor(classified)).toEqual(path);
  });

  it("shows no banner for an unrecognised Android browser rather than guess", () => {
    const profile = classifyBrowser("Mozilla/5.0 (Linux; Android 13) Gecko/1.0 Odd/1.0");
    expect(profile).toEqual({ os: "android", family: "unknown", iosVersion: null });
    expect(installPathFor(profile)).toEqual({ kind: "none" });
  });

  it("does not trust a third-party iOS browser whose version it cannot read", () => {
    const path = installPathFor({ os: "ios", family: "chromium", iosVersion: null });
    expect(path).toEqual(guide("ios-open-in-safari"));
  });

  it("falls back to the Safari version when the UA has no OS version", () => {
    expect(classifyBrowser(UA.ipadDesktopMode, 5).iosVersion).toBe(1700);
    expect(
      classifyBrowser("Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1", 0)
        .iosVersion,
    ).toBeNull();
  });
});

describe("INSTALL_GUIDES", () => {
  it("has copy for every guide a path can name", () => {
    for (const entry of Object.values(INSTALL_GUIDES)) {
      expect(entry.title).not.toBe("");
      expect(entry.steps).not.toBe("");
    }
  });
});
