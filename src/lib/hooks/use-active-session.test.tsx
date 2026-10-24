import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiClientModule from "@/lib/api-client";
import { ApiRequestError } from "@/lib/api-client";
import { useActiveSession } from "@/lib/hooks/use-active-session";
import { knownSessionKind } from "@/lib/session/known-kind";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

function Probe() {
  const active = useActiveSession();
  return <p>{active === null ? "none" : active.session.title}</p>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useActiveSession", () => {
  it("asks once and gives the running session", async () => {
    apiFetch.mockResolvedValue({ session: { title: "Tonight" }, blocks: [] });
    render(<Probe />);
    expect(await screen.findByText("Tonight")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/sessions/active");
  });

  it("tells the next screen what kind of session is running", async () => {
    apiFetch.mockResolvedValue({ session: { title: "Revisits", kind: "follow_up" }, blocks: [] });
    render(<Probe />);
    await screen.findByText("Revisits");
    expect(knownSessionKind.getSnapshot()).toBe("follow_up");
  });

  it("is null when nothing is running or it cannot be read", async () => {
    apiFetch.mockRejectedValue(new ApiRequestError(404, undefined));
    render(<Probe />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalled();
    });
    expect(screen.getByText("none")).toBeInTheDocument();
  });

  it("ignores an answer that lands after the screen has gone", async () => {
    let answer: (value: unknown) => void = () => undefined;
    apiFetch.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { unmount } = render(<Probe />);
    unmount();
    answer({ session: { title: "Late" }, blocks: [] });
    await Promise.resolve();
    expect(screen.queryByText("Late")).toBeNull();
  });
});
