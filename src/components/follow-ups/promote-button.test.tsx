import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromoteButton } from "@/components/follow-ups/promote-button";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useOnline } = vi.hoisted(() => ({ useOnline: vi.fn() }));
vi.mock("@/lib/hooks/use-online", () => ({ useOnline }));

beforeEach(() => {
  vi.clearAllMocks();
  useOnline.mockReturnValue(true);
});

const mount = (onPromoted = vi.fn()) => {
  render(<PromoteButton suggestionId="s1" onPromoted={onPromoted} className="" />);
  return onPromoted;
};

describe("PromoteButton", () => {
  it("lists the waiting suggestion itself rather than writing a second note", async () => {
    apiFetch.mockResolvedValue({});
    const onPromoted = mount();
    fireEvent.click(screen.getByRole("button", { name: "Add to follow-up list" }));
    await waitFor(() => {
      expect(onPromoted).toHaveBeenCalledTimes(1);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups/s1", {
      method: "PATCH",
      body: JSON.stringify({ status: "listed" }),
    });
  });

  it("sends one request however often it is tapped while working, and says so", async () => {
    let finish: (value: unknown) => void = () => undefined;
    apiFetch.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const onPromoted = mount();
    const button = screen.getByRole("button", { name: "Add to follow-up list" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    finish({});
    await waitFor(() => {
      expect(onPromoted).toHaveBeenCalledTimes(1);
    });
  });

  it("says why it failed, and stays offered for another go", async () => {
    apiFetch.mockRejectedValueOnce(
      new ApiRequestError(404, { error: { code: "not_found", message: "gone" } }),
    );
    const onPromoted = mount();
    fireEvent.click(screen.getByRole("button", { name: "Add to follow-up list" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That note or unit is no longer there. Refresh to see the latest.",
    );
    expect(onPromoted).not.toHaveBeenCalled();

    apiFetch.mockResolvedValueOnce({});
    fireEvent.click(screen.getByRole("button", { name: "Add to follow-up list" }));
    await waitFor(() => {
      expect(onPromoted).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is not offered for a tap without signal, as no follow-up change is", () => {
    useOnline.mockReturnValue(false);
    mount();
    expect(screen.getByRole("button", { name: "Add to follow-up list" })).toBeDisabled();
  });
});
