import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalRequests } from "@/components/admin/approval-requests";
import type { User } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import { formatDay } from "@/lib/history/dates";
import { approvalCount } from "@/lib/session/approval-count";
import { nextFrame } from "../../../test/next-frame";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const ASKED = "2026-03-14T11:00:00.000Z";

function person(id: string, name: string | null, approval: User["approval"] = "pending"): User {
  return {
    id,
    email: `${id}@gmail.com`,
    name,
    image: null,
    role: "member",
    approval,
    deactivatedAt: null,
    lastRecordedAt: null,
    createdAt: ASKED,
  };
}

const page = (users: User[], total = users.length) => ({
  data: users,
  pagination: { limit: 100, offset: 0, total, hasMore: total > users.length },
});

const PAT = person("pat", "Pat");
const QUINN = person("quinn", null);
const ROB = person("rob", "Rob", "blocked");

/* Answers a read with `lists[approval]`, and a POST with `moved`. */
function serve(lists: Partial<Record<string, User[]>>, moved: unknown = PAT) {
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    if (init?.method === "POST") return Promise.resolve(moved);
    const approval = new URLSearchParams(path.split("?")[1]).get("approval") ?? "";
    return Promise.resolve(page(lists[approval] ?? []));
  });
}

function row(text: string): HTMLElement {
  const card = screen.getByText(text).closest("li");
  if (!card) throw new Error(`no row for ${text}`);
  return card;
}

const conflict = (message: string) =>
  new ApiRequestError(409, { error: { code: "conflict", message } });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ApprovalRequests, waiting for approval (#249)", () => {
  it("lists who asked, oldest first as the server sends them, with the count in the heading", async () => {
    serve({ pending: [PAT, QUINN] });
    render(<ApprovalRequests approval="pending" version={0} onChanged={vi.fn()} />);

    expect(
      await screen.findByRole("heading", { name: "Waiting for approval (2)" }),
    ).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/users?approval=pending&limit=100");
    expect(within(row("Pat")).getByText("pat@gmail.com")).toBeInTheDocument();
    expect(within(row("Pat")).getByText(`Asked ${formatDay(ASKED)}`)).toBeInTheDocument();
    // Google gave Quinn no name: the request still reads, by address.
    expect(within(row("No name given")).getByText("quinn@gmail.com")).toBeInTheDocument();
    expect(
      within(row("No name given")).getByRole("button", { name: "Approve quinn@gmail.com" }),
    ).toBeInTheDocument();
  });

  it("tells apart two requests Google gave the same name, in their controls and in the question", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const first = person("twin.a", "Twin");
    const second = person("twin.b", "Twin");
    serve({ pending: [first, second] }, { ...second, approval: "blocked" });
    render(<ApprovalRequests approval="pending" version={0} onChanged={onChanged} />);

    expect(
      await screen.findByRole("button", { name: "Approve Twin (twin.a@gmail.com)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Approve Twin (twin.b@gmail.com)" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reject Twin (twin.b@gmail.com)" }));
    const dialog = screen.getByRole("alertdialog", { name: "Reject Twin (twin.b@gmail.com)?" });
    await user.click(within(dialog).getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith("rejected");
    });
    expect(apiFetch).toHaveBeenCalledWith("/users/twin.b/reject", { method: "POST" });
  });

  it("keeps the Admin tab's count to what it read", async () => {
    serve({ pending: [PAT, QUINN] });
    render(<ApprovalRequests approval="pending" version={0} onChanged={vi.fn()} />);
    await screen.findByText("Pat");
    expect(approvalCount.getSnapshot()).toBe(2);
  });

  it("is hidden while it reads, and when nobody waits", async () => {
    serve({ pending: [] });
    const { container } = render(
      <ApprovalRequests approval="pending" version={0} onChanged={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalled();
    });
    await nextFrame();
    expect(container).toBeEmptyDOMElement();
  });

  it("says so in a line when it cannot check, without standing in the team's way", async () => {
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<ApprovalRequests approval="pending" version={0} onChanged={vi.fn()} />);
    expect(
      await screen.findByText("Could not check who is waiting for approval."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says how many it leaves out past the first page", async () => {
    apiFetch.mockResolvedValue(page([PAT], 120));
    render(<ApprovalRequests approval="pending" version={0} onChanged={vi.fn()} />);
    expect(await screen.findByText("The oldest 1 of 120 are shown.")).toBeInTheDocument();
  });

  it("approves in one tap, reads again and tells Team", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    serve({ pending: [PAT, QUINN] });
    render(<ApprovalRequests approval="pending" version={0} onChanged={onChanged} />);
    await screen.findByText("Pat");

    serve({ pending: [QUINN] }, { ...PAT, approval: "approved" });
    await user.click(screen.getByRole("button", { name: "Approve Pat (pat@gmail.com)" }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith("approved");
    });
    expect(apiFetch).toHaveBeenCalledWith("/users/pat/approve", { method: "POST" });
    expect(screen.queryByText("Pat")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Waiting for approval (1)" })).toBeInTheDocument();
    expect(approvalCount.getSnapshot()).toBe(1);
  });

  it("asks before rejecting, saying what it does, and does nothing on Keep as it is", async () => {
    const user = userEvent.setup();
    serve({ pending: [PAT] });
    render(<ApprovalRequests approval="pending" version={0} onChanged={vi.fn()} />);
    await screen.findByText("Pat");

    await user.click(screen.getByRole("button", { name: "Reject Pat (pat@gmail.com)" }));
    const dialog = screen.getByRole("alertdialog", { name: "Reject Pat (pat@gmail.com)?" });
    expect(
      within(dialog).getByText(
        "They won't be able to use the app or ask again. You can unblock them under Not approved.",
      ),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Keep as it is" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledOnce();
  });

  it("rejects once confirmed, and tells Team so Not approved reads again", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    serve({ pending: [QUINN] });
    render(<ApprovalRequests approval="pending" version={0} onChanged={onChanged} />);
    await screen.findByText("No name given");

    serve({ pending: [] }, { ...QUINN, approval: "blocked" });
    await user.click(screen.getByRole("button", { name: "Reject quinn@gmail.com" }));
    const dialog = screen.getByRole("alertdialog", { name: "Reject quinn@gmail.com?" });
    await user.click(within(dialog).getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith("rejected");
    });
    expect(apiFetch).toHaveBeenCalledWith("/users/quinn/reject", { method: "POST" });
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("says a failed change in its row, in view, and gives focus back, reading nothing again", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    try {
      const user = userEvent.setup();
      const onChanged = vi.fn();
      serve({ pending: [PAT, QUINN] });
      render(<ApprovalRequests approval="pending" version={0} onChanged={onChanged} />);
      await screen.findByText("Pat");
      let refuse: (reason: unknown) => void = () => undefined;
      apiFetch.mockReturnValueOnce(
        new Promise((_, reject) => {
          refuse = reject;
        }),
      );

      const approve = screen.getByRole("button", { name: "Approve quinn@gmail.com" });
      await user.click(approve);
      expect(approve).toBeDisabled();
      expect(screen.getByRole("button", { name: "Approve Pat (pat@gmail.com)" })).toBeDisabled();
      await nextFrame();

      refuse(new TypeError("Failed to fetch"));
      const alert = await within(row("No name given")).findByRole("alert");
      expect(alert).toHaveTextContent("Could not make that change.");
      expect(within(row("Pat")).queryByRole("alert")).not.toBeInTheDocument();
      expect(alert.parentElement).toHaveClass("scroll-clear-nav");
      expect(scrolled.mock.contexts).toEqual([alert.parentElement]);
      expect(approve).toHaveFocus();
      expect(onChanged).not.toHaveBeenCalled();
      expect(apiFetch).toHaveBeenCalledTimes(2);
    } finally {
      scrolled.mockRestore();
    }
  });

  it("reads again and tells Team when another admin got there first, keeping the reason in the row", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    serve({ pending: [PAT, QUINN] });
    render(<ApprovalRequests approval="pending" version={0} onChanged={onChanged} />);
    await screen.findByText("Pat");

    apiFetch.mockRejectedValueOnce(conflict("Their request was rejected. Unblock them first."));
    await user.click(screen.getByRole("button", { name: "Approve Pat (pat@gmail.com)" }));

    expect(await within(row("Pat")).findByRole("alert")).toHaveTextContent(
      "Their request was rejected. Unblock them first.",
    );
    expect(onChanged).toHaveBeenCalledWith("stale");
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(3);
    });
  });

  it("says the reason at the top when the person it is about has left the list", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    try {
      const user = userEvent.setup();
      serve({ pending: [PAT] });
      render(<ApprovalRequests approval="pending" version={0} onChanged={vi.fn()} />);
      await screen.findByText("Pat");

      serve({ pending: [] });
      apiFetch.mockRejectedValueOnce(conflict("They've already been approved."));
      await user.click(screen.getByRole("button", { name: "Approve Pat (pat@gmail.com)" }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("They've already been approved.");
      await waitFor(() => {
        expect(screen.queryByText("Pat")).not.toBeInTheDocument();
      });
      expect(screen.getByRole("heading", { name: "Waiting for approval (0)" })).toBeInTheDocument();
      expect(screen.getByRole("alert").parentElement).toHaveClass("scroll-clear-nav");
      expect(scrolled.mock.contexts).toContain(screen.getByRole("alert").parentElement);
    } finally {
      scrolled.mockRestore();
    }
  });

  it("reads again when Team says someone moved into it", async () => {
    serve({ pending: [] });
    const { rerender } = render(
      <ApprovalRequests approval="pending" version={0} onChanged={vi.fn()} />,
    );
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledOnce();
    });

    serve({ pending: [ROB] });
    rerender(<ApprovalRequests approval="pending" version={1} onChanged={vi.fn()} />);
    expect(await screen.findByText("Rob")).toBeInTheDocument();
  });

  it("draws only the newest read when an older one answers late", async () => {
    let answerFirst: (value: unknown) => void = () => undefined;
    apiFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        answerFirst = resolve;
      }),
    );
    const { rerender } = render(
      <ApprovalRequests approval="pending" version={0} onChanged={vi.fn()} />,
    );
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledOnce();
    });

    serve({ pending: [QUINN] });
    rerender(<ApprovalRequests approval="pending" version={1} onChanged={vi.fn()} />);
    expect(await screen.findByText("No name given")).toBeInTheDocument();

    answerFirst(page([PAT]));
    await nextFrame();
    expect(screen.queryByText("Pat")).not.toBeInTheDocument();
    expect(screen.getByText("No name given")).toBeInTheDocument();
  });

  it("drops a late failure too, once a newer read has answered", async () => {
    let failFirst: (reason: unknown) => void = () => undefined;
    apiFetch.mockReturnValueOnce(
      new Promise((_, reject) => {
        failFirst = reject;
      }),
    );
    const { rerender } = render(
      <ApprovalRequests approval="pending" version={0} onChanged={vi.fn()} />,
    );
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledOnce();
    });
    serve({ pending: [PAT] });
    rerender(<ApprovalRequests approval="pending" version={1} onChanged={vi.fn()} />);
    await screen.findByText("Pat");

    failFirst(new TypeError("Failed to fetch"));
    await nextFrame();
    expect(screen.getByText("Pat")).toBeInTheDocument();
  });
});

describe("ApprovalRequests, not approved (#249)", () => {
  it("lists who was turned down, and unblocks in one tap without touching the count", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    approvalCount.set(5);
    serve({ blocked: [ROB] });
    render(<ApprovalRequests approval="blocked" version={0} onChanged={onChanged} />);

    expect(await screen.findByRole("heading", { name: "Not approved (1)" })).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/users?approval=blocked&limit=100");
    expect(within(row("Rob")).queryByRole("button", { name: /Approve|Reject/ })).toBeNull();

    serve({ blocked: [] }, { ...ROB, approval: "pending" });
    await user.click(screen.getByRole("button", { name: "Unblock Rob (rob@gmail.com)" }));
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith("unblocked");
    });
    expect(apiFetch).toHaveBeenCalledWith("/users/rob/unblock", { method: "POST" });
    expect(screen.queryByText("Rob")).not.toBeInTheDocument();
    expect(approvalCount.getSnapshot()).toBe(5);
  });

  it("says so in its own words when it cannot check", async () => {
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<ApprovalRequests approval="blocked" version={0} onChanged={vi.fn()} />);
    expect(await screen.findByText("Could not check who wasn't approved.")).toBeInTheDocument();
  });
});
