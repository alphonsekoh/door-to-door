import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstallPrompt } from "@/components/install-prompt";
import { DISMISS_KEY, INSTALLED_KEY } from "@/lib/install-prompt";

const { pathname, role } = vi.hoisted(() => ({
  pathname: { current: "/" },
  role: { signedIn: true },
}));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));
vi.mock("@/lib/use-role", () => ({ useRole: () => ({ isSignedIn: role.signedIn }) }));

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36";
const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IOS_CHROME_OLD =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/118.0.5993.69 Mobile/15E148 Safari/604.1";
const ANDROID_FIREFOX = "Mozilla/5.0 (Android 13; Mobile; rv:118.0) Gecko/118.0 Firefox/118.0";
const INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21A329 Instagram 300.0.0.29.110";

function setEnvironment(userAgent: string, standalone = false) {
  Object.defineProperty(navigator, "userAgent", { value: userAgent, configurable: true });
  Object.defineProperty(navigator, "standalone", { value: undefined, configurable: true });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: standalone && query === "(display-mode: standalone)",
  }));
}

function installEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const prompt = vi.fn(() => Promise.resolve());
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
  return { event, prompt };
}

const banner = () => screen.queryByRole("complementary", { name: "Install the app" });

beforeEach(() => {
  localStorage.clear();
  pathname.current = "/";
  role.signedIn = true;
  setEnvironment(ANDROID_CHROME);
});

describe("InstallPrompt on Chromium", () => {
  it("stays hidden until the browser says the app is installable", async () => {
    render(<InstallPrompt />);
    await act(() => Promise.resolve());
    expect(banner()).toBeNull();
  });

  it("offers Install once the event fires, and the dialog can be used only once", async () => {
    const user = userEvent.setup();
    render(<InstallPrompt />);
    const { event, prompt } = installEvent();
    act(() => {
      window.dispatchEvent(event);
    });

    // The browser's own mini-infobar is suppressed so ours is the only offer.
    expect(event.defaultPrevented).toBe(true);
    await user.click(await screen.findByRole("button", { name: "Install" }));

    expect(prompt).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(banner()).toBeNull();
    });
  });

  it("remembers a refusal in the browser's own dialog", async () => {
    const user = userEvent.setup();
    render(<InstallPrompt />);
    act(() => {
      window.dispatchEvent(installEvent("dismissed").event);
    });
    await user.click(await screen.findByRole("button", { name: "Install" }));

    await waitFor(() => {
      expect(localStorage.getItem(DISMISS_KEY)).not.toBeNull();
    });
    expect(banner()).toBeNull();
  });

  it("hides at once when the app gets installed, and remembers it", async () => {
    render(<InstallPrompt />);
    act(() => {
      window.dispatchEvent(installEvent().event);
    });
    await screen.findByRole("button", { name: "Install" });

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });

    expect(banner()).toBeNull();
    expect(localStorage.getItem(INSTALLED_KEY)).toBe("1");
  });

  it("does not wait for appinstalled before hiding after Not now, and keeps it hidden", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<InstallPrompt />);
    act(() => {
      window.dispatchEvent(installEvent().event);
    });
    await user.click(await screen.findByRole("button", { name: "Not now" }));
    expect(banner()).toBeNull();
    unmount();

    // A later visit inside the 30 days: the browser fires the event again.
    render(<InstallPrompt />);
    act(() => {
      window.dispatchEvent(installEvent().event);
    });
    await act(() => Promise.resolve());
    expect(banner()).toBeNull();
  });

  it("stays hidden when the app is installed before this page has read its storage", async () => {
    render(<InstallPrompt />);
    // Both fire before the deferred read, so neither has any state to update.
    act(() => {
      window.dispatchEvent(installEvent().event);
      window.dispatchEvent(new Event("appinstalled"));
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(localStorage.getItem(INSTALLED_KEY)).toBe("1");
    expect(banner()).toBeNull();
  });

  it("shows again for someone who installed, then removed the app", async () => {
    // Only a real beforeinstallprompt proves the app is no longer installed.
    localStorage.setItem(INSTALLED_KEY, "1");
    render(<InstallPrompt />);
    // Past the deferred read, so the page already believes the app installed.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(banner()).toBeNull();

    act(() => {
      window.dispatchEvent(installEvent().event);
    });

    expect(await screen.findByRole("button", { name: "Install" })).toBeInTheDocument();
    expect(localStorage.getItem(INSTALLED_KEY)).toBeNull();
  });

  it("never shows inside the installed app", async () => {
    setEnvironment(ANDROID_CHROME, true);
    render(<InstallPrompt />);
    act(() => {
      window.dispatchEvent(installEvent().event);
    });
    await act(() => Promise.resolve());
    expect(banner()).toBeNull();
  });

  it("still catches the event on the sign-in screen, then shows after sign-in", async () => {
    role.signedIn = false;
    pathname.current = "/sign-in";
    const { rerender } = render(<InstallPrompt />);
    act(() => {
      window.dispatchEvent(installEvent().event);
    });
    expect(banner()).toBeNull();

    role.signedIn = true;
    pathname.current = "/";
    rerender(<InstallPrompt />);
    expect(await screen.findByRole("button", { name: "Install" })).toBeInTheDocument();
  });

  it.each([
    ["signed out", () => (role.signedIn = false)],
    ["a public route", () => (pathname.current = "/sign-in")],
    ["the recording screen", () => (pathname.current = "/blocks/abc")],
  ])("is hidden on %s", async (_name, arrange) => {
    arrange();
    render(<InstallPrompt />);
    act(() => {
      window.dispatchEvent(installEvent().event);
    });
    await act(() => Promise.resolve());
    expect(banner()).toBeNull();
  });
});

describe("InstallPrompt where there is no install event", () => {
  it("tells an iOS Safari member to use Share, and dismisses for good", async () => {
    setEnvironment(IOS_SAFARI);
    const user = userEvent.setup();
    render(<InstallPrompt />);

    expect(await screen.findByText(/Add to Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(banner()).toBeNull();
    expect(localStorage.getItem(DISMISS_KEY)).not.toBeNull();
  });

  it("sends an old iOS third-party browser to Safari", async () => {
    setEnvironment(IOS_CHROME_OLD);
    render(<InstallPrompt />);
    expect(await screen.findByText(/Open this page in Safari/)).toBeInTheDocument();
  });

  it("gives Android Firefox its menu steps", async () => {
    setEnvironment(ANDROID_FIREFOX);
    render(<InstallPrompt />);
    expect(await screen.findByText(/Install or Add to Home screen/)).toBeInTheDocument();
  });

  it("never offers a dead Install button inside an in-app browser", async () => {
    setEnvironment(INSTAGRAM);
    render(<InstallPrompt />);
    expect(await screen.findByText(/Open this page in your phone's browser/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("shows nothing in a browser it does not recognise", async () => {
    setEnvironment("SomeBrowser/1.0");
    render(<InstallPrompt />);
    await act(() => Promise.resolve());
    expect(banner()).toBeNull();
  });

  it("shows nothing on iOS once added to the home screen", async () => {
    setEnvironment(IOS_SAFARI);
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    render(<InstallPrompt />);
    await act(() => Promise.resolve());
    expect(banner()).toBeNull();
  });
});

describe("InstallPrompt reserved space", () => {
  it("keeps content clear of the banner while it shows, and releases it when dismissed", async () => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get: () => 72,
    });
    const user = userEvent.setup();
    render(<InstallPrompt />);
    act(() => {
      window.dispatchEvent(installEvent().event);
    });
    await screen.findByRole("button", { name: "Install" });
    const bottom = () => document.documentElement.style.getPropertyValue("--banner-bottom");
    expect(bottom()).toBe("72px");

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(bottom()).toBe("72px");

    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(bottom()).toBe("");
    Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
  });
});
