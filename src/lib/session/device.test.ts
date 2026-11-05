import { describe, expect, it } from "vitest";
import { UNKNOWN_DEVICE, describeDevice } from "@/lib/session/device";

/* Real user agents, as phones and browsers send them. */
describe("describeDevice", () => {
  it.each([
    [
      "Chrome on Android",
      "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    ],
    [
      "Safari on iPhone",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    ],
    [
      // Added to the home screen: no Safari token, still Safari.
      "Safari on iPhone",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    ],
    [
      "Chrome on iPhone",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
    ],
    [
      "Firefox on iPhone",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15",
    ],
    [
      "Safari on iPad",
      "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
    ],
    [
      "Samsung Internet on Android",
      "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
    ],
    [
      "Edge on Windows",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
    ],
    ["Firefox on Linux", "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0"],
    [
      "Safari on Mac",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
    ],
    [
      "Chrome on ChromeOS",
      "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ],
  ])("calls it %s", (label, userAgent) => {
    expect(describeDevice(userAgent)).toBe(label);
  });

  it("names what it can when it knows only the browser or only the system", () => {
    expect(describeDevice("curl/8.4.0 Chrome/1")).toBe("Chrome");
    expect(describeDevice("SomeApp/1.0 (Linux; Android 14)")).toBe("Unknown browser on Android");
    // Not WebKit, so not Safari, though it is an iPhone.
    expect(describeDevice("SomeApp/1.0 (iPhone; iOS 17)")).toBe("Unknown browser on iPhone");
  });

  it("says it does not know rather than showing what was sent", () => {
    expect(describeDevice(null)).toBe(UNKNOWN_DEVICE);
    expect(describeDevice("")).toBe(UNKNOWN_DEVICE);
    expect(describeDevice("<script>alert(1)</script>")).toBe(UNKNOWN_DEVICE);
  });
});
