import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdatePrompt } from "@/components/update-prompt";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubServiceWorker(waiting: ServiceWorker | null, controller: object | null = {}) {
  const postMessage = vi.fn();
  const worker = { postMessage } as unknown as ServiceWorker;
  const registration = {
    waiting: waiting === null ? null : worker,
    installing: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const serviceWorker = {
    controller,
    ready: Promise.resolve(registration),
    addEventListener: vi.fn(),
  };
  Object.defineProperty(navigator, "serviceWorker", { value: serviceWorker, configurable: true });
  return { postMessage, serviceWorker, registration };
}

describe("UpdatePrompt", () => {
  it("says nothing when no new version is waiting", async () => {
    stubServiceWorker(null);
    render(<UpdatePrompt />);
    await act(() => Promise.resolve());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("waits for the worker to be registered on a first load", async () => {
    const { registration, serviceWorker } = stubServiceWorker(null);
    let register: (value: unknown) => void = () => undefined;
    Object.assign(serviceWorker, {
      ready: new Promise((resolve) => {
        register = resolve;
      }),
    });
    render(<UpdatePrompt />);
    await act(() => Promise.resolve());
    expect(registration.addEventListener).not.toHaveBeenCalled();

    register(registration);
    await waitFor(() => {
      expect(registration.addEventListener).toHaveBeenCalledWith(
        "updatefound",
        expect.any(Function),
      );
    });
  });

  it("says nothing in a browser without service workers", async () => {
    Reflect.deleteProperty(navigator, "serviceWorker");
    render(<UpdatePrompt />);
    await act(() => Promise.resolve());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("offers a reload, and does not reload by itself", async () => {
    const { postMessage } = stubServiceWorker({} as ServiceWorker);
    const reload = vi.fn();
    render(<UpdatePrompt reload={reload} />);

    expect(await screen.findByText("Update available.")).toBeInTheDocument();
    expect(postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("switches to the new version and reloads only after the member taps Reload", async () => {
    const user = userEvent.setup();
    const { postMessage, serviceWorker } = stubServiceWorker({} as ServiceWorker);
    const reload = vi.fn();
    render(<UpdatePrompt reload={reload} />);

    await user.click(await screen.findByRole("button", { name: "Reload" }));

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    });
    expect(serviceWorker.addEventListener).toHaveBeenCalledWith("controllerchange", reload, {
      once: true,
    });
  });

  it("holds off while saved visits have not synced", async () => {
    const user = userEvent.setup();
    const { postMessage } = stubServiceWorker({} as ServiceWorker);
    const hasUnsynced = vi.fn(() => Promise.resolve(true));
    render(<UpdatePrompt hasUnsynced={hasUnsynced} reload={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Reload" }));

    expect(await screen.findByText(/once your saved visits have synced/)).toBeInTheDocument();
    expect(postMessage).not.toHaveBeenCalled();

    // Once the queue drains, the same button goes through.
    hasUnsynced.mockResolvedValue(false);
    await user.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledOnce();
    });
    expect(screen.getByText("Update available.")).toBeInTheDocument();
  });

  it("does not treat the first install as an update", async () => {
    stubServiceWorker({} as ServiceWorker, null);
    render(<UpdatePrompt />);
    await act(() => Promise.resolve());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stops watching when it unmounts", async () => {
    const { registration } = stubServiceWorker(null);
    const { unmount } = render(<UpdatePrompt />);
    await waitFor(() => {
      expect(registration.addEventListener).toHaveBeenCalled();
    });
    unmount();
    expect(registration.removeEventListener).toHaveBeenCalled();
  });
});

describe("UpdatePrompt reserved space", () => {
  it("reserves room at the top while showing, and gives it back after", async () => {
    stubServiceWorker({} as ServiceWorker);
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get: () => 56,
    });
    const { unmount } = render(<UpdatePrompt />);
    await screen.findByRole("status");
    expect(document.documentElement.style.getPropertyValue("--banner-top")).toBe("56px");

    unmount();
    expect(document.documentElement.style.getPropertyValue("--banner-top")).toBe("");
    Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
  });
});
