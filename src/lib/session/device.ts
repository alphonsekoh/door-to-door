/*
 * A label for the device a sign-in came from, worked out from its user agent
 * (#125). The admin reads it to tell a member's phones apart, so it names the
 * browser and the system and nothing finer: the raw string is never shown.
 *
 * Order matters. Edge and Samsung Internet also say Chrome, and an iPhone
 * says "like Mac OS X".
 */

type Rule = readonly [RegExp, string];

const BROWSERS: readonly Rule[] = [
  [/\bEdg(e|A|iOS)?\//, "Edge"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(Firefox|FxiOS)\//, "Firefox"],
  [/(Chrome|CriOS)\//, "Chrome"],
];

const SYSTEMS: readonly Rule[] = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\b(Macintosh|Mac OS X)\b/, "Mac"],
  [/\bWindows\b/, "Windows"],
  [/\bLinux\b/, "Linux"],
];

const APPLE = new Set(["iPhone", "iPad", "Mac"]);

const first = (rules: readonly Rule[], text: string) =>
  rules.find(([pattern]) => pattern.test(text))?.[1];

export const UNKNOWN_DEVICE = "Unknown device";

export function describeDevice(userAgent: string | null): string {
  if (userAgent === null) return UNKNOWN_DEVICE;
  const system = first(SYSTEMS, userAgent);
  /* Any other WebKit browser on Apple's systems is Safari, an app added to
     the home screen included: it drops Safari's own token. */
  const browser =
    first(BROWSERS, userAgent) ??
    (system !== undefined && APPLE.has(system) && /\bAppleWebKit\//.test(userAgent)
      ? "Safari"
      : undefined);
  if (browser !== undefined && system !== undefined) return `${browser} on ${system}`;
  if (browser !== undefined) return browser;
  if (system !== undefined) return `Unknown browser on ${system}`;
  return UNKNOWN_DEVICE;
}
