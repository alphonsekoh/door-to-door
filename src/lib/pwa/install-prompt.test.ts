import { describe, expect, it } from "vitest";
import {
  DISMISS_KEY,
  DISMISS_SUPPRESSION_MS,
  FLOAT_LIMIT,
  INSTALLED_KEY,
  bannerFloats,
  deriveInstallState,
  isRecordingRoute,
  isStandalone,
  clearInstalled,
  readDismissedAt,
  readInstalled,
  writeDismissedAt,
  writeInstalled,
  type InstallFacts,
} from "@/lib/pwa/install-prompt";

const NOW = 1_800_000_000_000;

function facts(overrides: Partial<InstallFacts> = {}): InstallFacts {
  return {
    path: { kind: "event" },
    hasDeferredPrompt: true,
    standalone: false,
    installedFlag: false,
    dismissedAt: null,
    now: NOW,
    recording: false,
    ...overrides,
  };
}

describe("deriveInstallState", () => {
  it("offers the install dialog once Chromium has fired its event", () => {
    expect(deriveInstallState(facts())).toEqual({ kind: "available" });
  });

  it("offers nothing on Chromium until the event has fired", () => {
    expect(deriveInstallState(facts({ hasDeferredPrompt: false }))).toEqual({ kind: "idle" });
  });

  it("shows the manual steps where there is no event", () => {
    expect(
      deriveInstallState(
        facts({ path: { kind: "guide", guide: "ios-safari" }, hasDeferredPrompt: false }),
      ),
    ).toEqual({ kind: "manual", guide: "ios-safari" });
  });

  it("shows nothing for a browser it does not recognise", () => {
    expect(deriveInstallState(facts({ path: { kind: "none" } }))).toEqual({ kind: "idle" });
  });

  it("never shows inside the installed app", () => {
    expect(deriveInstallState(facts({ standalone: true }))).toEqual({ kind: "installed" });
  });

  it("stays hidden once installed, even in a browser tab", () => {
    expect(deriveInstallState(facts({ installedFlag: true }))).toEqual({ kind: "installed" });
  });

  it("installed wins over a dismissal", () => {
    expect(deriveInstallState(facts({ standalone: true, dismissedAt: NOW }))).toEqual({
      kind: "installed",
    });
  });

  it("stays hidden for 30 days after a dismissal, then returns", () => {
    const justInside = NOW - DISMISS_SUPPRESSION_MS + 1;
    const justOutside = NOW - DISMISS_SUPPRESSION_MS;
    expect(deriveInstallState(facts({ dismissedAt: justInside }))).toEqual({ kind: "dismissed" });
    expect(deriveInstallState(facts({ dismissedAt: justOutside }))).toEqual({ kind: "available" });
  });

  it("stays out of the way while recording", () => {
    expect(deriveInstallState(facts({ recording: true }))).toEqual({ kind: "idle" });
  });
});

describe("isStandalone", () => {
  const media = (matches: boolean) => () => ({ matches });

  it("reads the display-mode media query", () => {
    expect(isStandalone(media(true), undefined)).toBe(true);
    expect(isStandalone(media(false), undefined)).toBe(false);
  });

  it("reads Safari's navigator.standalone", () => {
    expect(isStandalone(media(false), true)).toBe(true);
    expect(isStandalone(media(false), false)).toBe(false);
  });
});

describe("bannerFloats", () => {
  it("floats a banner up to a quarter of the screen", () => {
    expect(FLOAT_LIMIT).toBe(0.25);
    expect(bannerFloats({ height: 81, screen: 664, docked: false })).toBe(true);
    expect(bannerFloats({ height: 166, screen: 664, docked: false })).toBe(true);
  });

  it("puts a taller one in the page, as at the largest text", () => {
    expect(bannerFloats({ height: 167, screen: 664, docked: false })).toBe(false);
    expect(bannerFloats({ height: 273, screen: 664, docked: false })).toBe(false);
  });

  it("never floats over a docked Save, however small", () => {
    expect(bannerFloats({ height: 81, screen: 664, docked: true })).toBe(false);
  });
});

describe("isRecordingRoute", () => {
  it("covers the block screens only", () => {
    expect(isRecordingRoute("/blocks/abc")).toBe(true);
    expect(isRecordingRoute("/blocks")).toBe(true);
    expect(isRecordingRoute("/")).toBe(false);
    expect(isRecordingRoute("/blocksmith")).toBe(false);
  });
});

describe("storage", () => {
  function memory(): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
    };
  }

  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("full");
    },
  };

  it("round-trips a dismissal and the installed flag", () => {
    const storage = memory();
    expect(readDismissedAt(storage)).toBeNull();
    expect(readInstalled(storage)).toBe(false);

    writeDismissedAt(storage, NOW);
    writeInstalled(storage);

    expect(storage.data.get(DISMISS_KEY)).toBe(String(NOW));
    expect(storage.data.get(INSTALLED_KEY)).toBe("1");
    expect(readDismissedAt(storage)).toBe(NOW);
    expect(readInstalled(storage)).toBe(true);
  });

  it("forgets an installed flag, and survives storage that throws", () => {
    const storage = {
      ...memory(),
      removeItem(key: string) {
        this.data.delete(key);
      },
    };
    writeInstalled(storage);
    clearInstalled(storage);
    expect(readInstalled(storage)).toBe(false);

    expect(() => {
      clearInstalled({
        removeItem: () => {
          throw new Error("blocked");
        },
      });
    }).not.toThrow();
  });

  it("ignores a corrupted dismissal", () => {
    const storage = memory();
    storage.setItem(DISMISS_KEY, "yesterday");
    expect(readDismissedAt(storage)).toBeNull();
  });

  it("survives storage that throws", () => {
    expect(readDismissedAt(broken)).toBeNull();
    expect(readInstalled(broken)).toBe(false);
    expect(() => {
      writeDismissedAt(broken, NOW);
      writeInstalled(broken);
    }).not.toThrow();
  });
});
