import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminFollowUps, parseFollowUpTab } from "@/components/admin/admin-follow-ups";
import type { FollowUp, FollowUpList } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));

const { useOnline } = vi.hoisted(() => ({ useOnline: vi.fn() }));
vi.mock("@/lib/hooks/use-online", () => ({ useOnline }));

const { replace, search } = vi.hoisted(() => ({ replace: vi.fn(), search: { value: "" } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(search.value),
}));

const ANN = { id: "u1", name: "Ann Tan", image: null };
const ADMIN = { id: "a1", name: "Admin", image: null };

function note(id: string, over: Partial<FollowUp> = {}): FollowUp {
  return {
    id,
    householdId: `h-${id}`,
    blockId: "b1",
    blockName: "123",
    unitNumber: `#05-${id}`,
    visitId: null,
    status: "suggested",
    author: ANN,
    note: `Note ${id}`,
    dueDate: null,
    doneAt: null,
    doneBy: null,
    listedAt: null,
    listedBy: null,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    waitingSuggestionBy: null,
    createdAt: "2026-10-01T04:00:00.000Z",
    ...over,
  };
}

const page = (data: FollowUp[], total = data.length): FollowUpList => ({
  data,
  pagination: { limit: 20, offset: 0, total, hasMore: data.length < total },
});

/* Counts are asked with limit=1; each tab's own page with limit=20. No
   follow-up session is found for "Also add to". */
function serve(pages: Partial<Record<"review" | "list" | "dismissed", FollowUp[]>>) {
  apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method !== undefined) return Promise.resolve({});
    if (path.startsWith("/sessions?")) return Promise.resolve({ data: [] });
    const which = path.includes("deleted=true")
      ? "dismissed"
      : path.includes("status=suggested")
        ? "review"
        : "list";
    const rows = pages[which] ?? [];
    return Promise.resolve(
      path.includes("limit=1&") || path.endsWith("limit=1")
        ? page(rows.slice(0, 1), rows.length)
        : page(rows),
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  search.value = "";
  localStorage.clear();
  useRole.mockReturnValue({ userId: "a1", isAdmin: true });
  useOnline.mockReturnValue(true);
});

describe("parseFollowUpTab", () => {
  it("reads only the known tabs, and To review otherwise", () => {
    expect(parseFollowUpTab(new URLSearchParams("tab=list"))).toBe("list");
    expect(parseFollowUpTab(new URLSearchParams("tab=dismissed"))).toBe("dismissed");
    expect(parseFollowUpTab(new URLSearchParams("tab=other"))).toBe("review");
    expect(parseFollowUpTab(new URLSearchParams())).toBe("review");
  });
});

describe("AdminFollowUps", () => {
  it("counts what waits in each tab, on a line under its name", async () => {
    serve({ review: [note("1"), note("2")], list: [note("3", { status: "listed" })] });
    render(<AdminFollowUps />);
    const review = await screen.findByRole("button", { name: "To review, 2" });
    expect(review).toHaveAttribute("aria-pressed", "true");
    // Two lines, so the label never wraps mid-phrase at phone width.
    expect([...review.children].map((line) => line.textContent)).toEqual(["To review", "2"]);
    expect(screen.getByRole("button", { name: "On the list, 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismissed" })).toBeInTheDocument();
  });

  it("reads the tabs without numbers when the counts fail", async () => {
    apiFetch.mockImplementation((path: string) =>
      path.endsWith("limit=1")
        ? Promise.reject(new TypeError("offline"))
        : Promise.resolve(page([])),
    );
    render(<AdminFollowUps />);
    expect(await screen.findByText("No suggestions to review.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "To review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "On the list" })).toBeInTheDocument();
  });

  it("adds a suggestion to the list from a sheet, says so, and both tabs re-read", async () => {
    serve({ review: [note("1")] });
    render(<AdminFollowUps />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to list" }));
    const sheet = within(screen.getByRole("dialog", { name: "Add to the follow-up list, #05-1" }));
    const add = sheet.getByRole("button", { name: "Add to list" });
    await waitFor(() => {
      expect(add).toBeEnabled();
    });
    fireEvent.click(add);
    expect(await screen.findByRole("status")).toHaveTextContent("Added to the follow-up list.");
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/follow-ups/1", {
        method: "PATCH",
        body: JSON.stringify({ status: "listed" }),
      });
    });
    await waitFor(() => {
      expect(
        apiFetch.mock.calls.filter(
          ([path]) => path === "/follow-ups?status=suggested&limit=20&offset=0",
        ),
      ).toHaveLength(2);
    });
  });

  it("dismisses a suggestion with a reason the author will see", async () => {
    serve({ review: [note("1")] });
    render(<AdminFollowUps />);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    const sheet = within(screen.getByRole("dialog", { name: "Dismiss this suggestion?" }));
    expect(sheet.getByText("Ann will be told it was not added, with your reason.")).toBeVisible();
    fireEvent.change(sheet.getByLabelText("Why not add it?"), { target: { value: "Moved" } });
    fireEvent.click(sheet.getByRole("button", { name: "Dismiss suggestion" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/follow-ups/1/remove", {
        method: "POST",
        body: JSON.stringify({ reason: "Moved" }),
      });
    });
  });

  it("keeps a suggestion on Keep it, with nothing sent", async () => {
    serve({ review: [note("1")] });
    render(<AdminFollowUps />);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    const sheet = within(screen.getByRole("dialog", { name: "Dismiss this suggestion?" }));
    fireEvent.click(sheet.getByRole("button", { name: "Keep it" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(apiFetch).not.toHaveBeenCalledWith("/follow-ups/1/remove", expect.anything());
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("edits a suggestion in the sheet", async () => {
    serve({ review: [note("1")] });
    render(<AdminFollowUps />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const sheet = within(screen.getByRole("dialog", { name: "Edit suggestion, #05-1" }));
    fireEvent.change(sheet.getByLabelText("Why should we go back?"), {
      target: { value: "Changed" },
    });
    fireEvent.click(sheet.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups/1", {
      method: "PATCH",
      body: JSON.stringify({ note: "Changed" }),
    });
  });

  it("closes the edit sheet on Cancel", async () => {
    serve({ review: [note("1")] });
    render(<AdminFollowUps />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("offers Mark done, Edit and Remove on the list", async () => {
    search.value = "tab=list";
    serve({ list: [note("3", { status: "listed" })] });
    render(<AdminFollowUps />);
    expect(await screen.findByRole("button", { name: "Mark done" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove from list" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to list" })).toBeNull();
    expect(apiFetch).toHaveBeenCalledWith(
      "/follow-ups?status=listed&outstanding=true&limit=20&offset=0",
    );
  });

  it("shows what was taken off, by whom and why, with nothing to change", async () => {
    search.value = "tab=dismissed";
    const deletedAt = new Date(2026, 9, 20, 12).toISOString();
    serve({
      dismissed: [
        note("1", { deletedAt, deletedBy: ADMIN, deleteReason: "Moved away" }),
        note("2", { deletedAt, deletedBy: ANN }),
        note("3", { status: "listed", author: ADMIN, deletedAt, deletedBy: ADMIN }),
      ],
    });
    render(<AdminFollowUps />);
    expect(await screen.findByText("Dismissed by Admin · 20 Oct 2026")).toBeInTheDocument();
    expect(screen.getByText("Reason: Moved away")).toBeInTheDocument();
    expect(screen.getByText("Withdrawn by Ann Tan · 20 Oct 2026")).toBeInTheDocument();
    expect(screen.getByText("Removed from the list by Admin · 20 Oct 2026")).toBeInTheDocument();
    expect(screen.getAllByText(/^Suggested by Ann Tan/)).toHaveLength(2);
    expect(screen.getByText(/^Added by Admin/)).toBeInTheDocument();
    for (const name of [
      "Mark done",
      "Reopen",
      "Edit",
      "Dismiss",
      "Remove from list",
      "Add to list",
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it.each([
    [
      "review",
      "No suggestions to review.",
      "When a member suggests a return visit, it appears here.",
    ],
    [
      "list",
      "The follow-up list is empty.",
      "Add households from Needs a return visit, or from a household's page.",
    ],
    ["dismissed", "Nothing has been dismissed.", null],
  ])("says plainly when %s is empty", async (tab, title, detail) => {
    search.value = `tab=${tab}`;
    serve({});
    render(<AdminFollowUps />);
    expect(await screen.findByText(title)).toBeInTheDocument();
    if (detail !== null) expect(screen.getByText(detail)).toBeInTheDocument();
  });

  it("switches tabs through the URL", async () => {
    serve({});
    render(<AdminFollowUps />);
    await screen.findByText("No suggestions to review.");
    fireEvent.click(screen.getByRole("button", { name: /^On the list/ }));
    expect(replace).toHaveBeenCalledWith("/admin/follow-ups?tab=list");
    fireEvent.click(screen.getByRole("button", { name: /^To review/ }));
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("pages with Show more", async () => {
    apiFetch.mockImplementation((path: string) => {
      if (path.endsWith("limit=1")) return Promise.resolve(page([note("1")], 2));
      return Promise.resolve(
        path.endsWith("offset=0")
          ? { data: [note("1")], pagination: { limit: 20, offset: 0, total: 2, hasMore: true } }
          : { data: [note("2")], pagination: { limit: 20, offset: 1, total: 2, hasMore: false } },
      );
    });
    render(<AdminFollowUps />);
    fireEvent.click(await screen.findByRole("button", { name: "Show more" }));
    expect(await screen.findByText("Note 2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("reports a failed read and tries again", async () => {
    apiFetch
      .mockImplementationOnce(() => Promise.reject(new TypeError("offline")))
      .mockImplementation(() => Promise.resolve(page([])));
    render(<AdminFollowUps />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load the list.");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No suggestions to review.")).toBeInTheDocument();
  });

  it("lets only the newest tab's answer land", async () => {
    let late: (value: unknown) => void = () => undefined;
    apiFetch.mockImplementation((path: string) => {
      if (path === "/follow-ups?status=suggested&limit=20&offset=0") {
        return new Promise((resolve) => {
          late = resolve;
        });
      }
      return Promise.resolve(page([]));
    });
    const { rerender } = render(<AdminFollowUps />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/follow-ups?status=suggested&limit=20&offset=0");
    });
    search.value = "tab=list";
    rerender(<AdminFollowUps />);
    expect(await screen.findByText("The follow-up list is empty.")).toBeInTheDocument();
    late(page([note("9")]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("Note 9")).toBeNull();
  });

  it("explains how the list works under it, so the first door is in view", async () => {
    serve({ review: [note("1")] });
    render(<AdminFollowUps />);
    const hint = await screen.findByRole("region", { name: "How the follow-up list works" });
    expect(hint).toHaveTextContent(
      "Then create a Follow-up session and pick which of them to visit; members can record visits only at the households you pick.",
    );
    const first = await screen.findByRole("button", { name: "Add to list" });
    expect(first.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("explains how the list works, once", async () => {
    serve({});
    render(<AdminFollowUps />);
    const hint = await screen.findByRole("region", { name: "How the follow-up list works" });
    fireEvent.click(within(hint).getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("region", { name: "How the follow-up list works" })).toBeNull();
  });
});
