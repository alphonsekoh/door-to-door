import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FollowUpsScreen, parseFollowUpView } from "@/components/follow-ups-screen";
import type { FollowUp, FollowUpList } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/use-role", () => ({ useRole }));

const { useOnline } = vi.hoisted(() => ({ useOnline: vi.fn() }));
vi.mock("@/lib/use-online", () => ({ useOnline }));

const { replace, search } = vi.hoisted(() => ({ replace: vi.fn(), search: { value: "" } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search.value),
}));

function note(id: string, overrides: Partial<FollowUp> = {}): FollowUp {
  return {
    id,
    householdId: `h-${id}`,
    blockName: "123",
    unitNumber: `#05-${id}`,
    visitId: null,
    author: { id: "u1", name: "Alice", image: null },
    note: `Note ${id}`,
    dueDate: null,
    doneAt: null,
    doneBy: null,
    createdAt: "2026-03-14T10:00:00.000Z",
    ...overrides,
  };
}

type Settle = {
  resolve: (value: FollowUpList) => void;
  reject: (reason: unknown) => void;
};

const page = (data: FollowUp[], total = data.length, offset = 0): FollowUpList => ({
  data,
  pagination: { limit: 20, offset, total, hasMore: offset + data.length < total },
});

beforeEach(() => {
  vi.clearAllMocks();
  search.value = "";
  useRole.mockReturnValue({ userId: "u1", isAdmin: false });
  useOnline.mockReturnValue(true);
});

describe("parseFollowUpView", () => {
  it("reads Mine only from the one known value", () => {
    expect(parseFollowUpView(new URLSearchParams("view=mine"))).toBe("mine");
    expect(parseFollowUpView(new URLSearchParams("view=team"))).toBe("everyone");
    expect(parseFollowUpView(new URLSearchParams())).toBe("everyone");
  });
});

describe("FollowUpsScreen", () => {
  it("lists everyone's outstanding notes by default, naming and linking each door", async () => {
    apiFetch.mockResolvedValue(page([note("1"), note("2")]));
    render(<FollowUpsScreen />);

    expect(await screen.findByRole("link", { name: "Blk 123 · #05-1" })).toHaveAttribute(
      "href",
      "/households/h-1",
    );
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups?outstanding=true&limit=20&offset=0");
    expect(screen.getByRole("button", { name: "Everyone" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("asks for the viewer's own notes under Mine", async () => {
    search.value = "view=mine";
    apiFetch.mockResolvedValue(page([]));
    render(<FollowUpsScreen />);

    expect(await screen.findByText("You have no follow-ups waiting.")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(
      "/follow-ups?outstanding=true&limit=20&offset=0&authorId=u1",
    );
  });

  it("waits for the viewer before asking for Mine", async () => {
    search.value = "view=mine";
    useRole.mockReturnValue({ userId: undefined, isAdmin: false });
    render(<FollowUpsScreen />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("says so when nothing is waiting", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<FollowUpsScreen />);
    expect(await screen.findByText("No follow-ups waiting.")).toBeInTheDocument();
  });

  it("switches views through the URL", async () => {
    apiFetch.mockResolvedValue(page([]));
    render(<FollowUpsScreen />);
    await screen.findByText("No follow-ups waiting.");

    fireEvent.click(screen.getByRole("button", { name: "Mine" }));
    expect(replace).toHaveBeenCalledWith("/follow-ups?view=mine");

    fireEvent.click(screen.getByRole("button", { name: "Everyone" }));
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("goes back to Everyone without a query", async () => {
    search.value = "view=mine";
    apiFetch.mockResolvedValue(page([]));
    render(<FollowUpsScreen />);
    await screen.findByText("You have no follow-ups waiting.");
    fireEvent.click(screen.getByRole("button", { name: "Everyone" }));
    expect(replace).toHaveBeenCalledWith("/follow-ups");
  });

  it("pages with Show more", async () => {
    apiFetch
      .mockResolvedValueOnce(page([note("1")], 2))
      .mockResolvedValueOnce(page([note("2")], 2, 1));
    render(<FollowUpsScreen />);

    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));
    expect(await screen.findByText("Note 2")).toBeInTheDocument();
    expect(screen.getByText("Note 1")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenLastCalledWith("/follow-ups?outstanding=true&limit=20&offset=1");
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("marks an overdue note", async () => {
    apiFetch.mockResolvedValue(page([note("1", { dueDate: "2020-01-01T00:00:00.000Z" })]));
    render(<FollowUpsScreen />);
    expect(await screen.findByText("Overdue")).toBeInTheDocument();
  });

  it("re-reads from the top after a note is marked done", async () => {
    apiFetch.mockImplementation((_path: string, init?: { method?: string }) =>
      Promise.resolve(
        init?.method === "PATCH" ? {} : page(apiFetch.mock.calls.length > 1 ? [] : [note("1")]),
      ),
    );
    render(<FollowUpsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark done" }));
    expect(await screen.findByText("No follow-ups waiting.")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups/1", {
      method: "PATCH",
      body: JSON.stringify({ done: true }),
    });
  });

  it("edits a note in the sheet and re-reads", async () => {
    apiFetch.mockImplementation((_path: string, init?: { method?: string }) =>
      Promise.resolve(init?.method === "PATCH" ? {} : page([note("1")])),
    );
    render(<FollowUpsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const sheet = within(screen.getByRole("dialog", { name: "Edit follow-up" }));
    fireEvent.change(sheet.getByLabelText("Note"), { target: { value: "Changed" } });
    fireEvent.click(sheet.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(apiFetch).toHaveBeenLastCalledWith("/follow-ups?outstanding=true&limit=20&offset=0");
  });

  it("closes the sheet on Cancel", async () => {
    apiFetch.mockResolvedValue(page([note("1")]));
    render(<FollowUpsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("reports a failed read and retries", async () => {
    apiFetch.mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(page([]));
    render(<FollowUpsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No follow-ups waiting.")).toBeInTheDocument();
  });

  /* A promise settles once, so the late answer and the late failure each
     need their own first request. */
  it.each([
    [
      "answer",
      (first: Settle) => {
        first.resolve(page([note("1")]));
      },
    ],
    [
      "failure",
      (first: Settle) => {
        first.reject(new Error("late"));
      },
    ],
  ])("lets only the newest answer land, not a late %s", async (_, settle) => {
    const first: Settle = { resolve: () => undefined, reject: () => undefined };
    apiFetch
      .mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            first.resolve = resolve;
            first.reject = reject;
          }),
      )
      .mockResolvedValue(page([]));
    const { rerender } = render(<FollowUpsScreen />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });
    search.value = "view=mine";
    rerender(<FollowUpsScreen />);
    expect(await screen.findByText("You have no follow-ups waiting.")).toBeInTheDocument();

    settle(first);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText("You have no follow-ups waiting.")).toBeInTheDocument();
    expect(screen.queryByText("Note 1")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
