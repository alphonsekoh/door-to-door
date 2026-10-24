import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiClientModule from "@/lib/api-client";
import { ApiRequestError } from "@/lib/api-client";
import {
  OFF_THE_LIST,
  RecordVisitForm,
  blockedMessage,
  validateVisit,
} from "@/components/visits/record-visit-form";
import type { ActiveSession, FollowUp, HouseholdSummary } from "@/generated/types.gen";
import { type VisitDraft, buildQueuedVisit } from "@/lib/sync/enqueue";
import { OUTING_ASK_TIMEOUT_MS, type OutingAnswer } from "@/lib/sync/outing";
import type { QueuedVisit } from "@/lib/sync/types";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));

const { useOnline } = vi.hoisted(() => ({ useOnline: vi.fn() }));
vi.mock("@/lib/hooks/use-online", () => ({ useOnline }));

/* Unavailable unless a test says otherwise: these tests describe the direct
   save, which is what runs when the queue cannot be opened. */
const { useSyncQueue } = vi.hoisted(() => ({ useSyncQueue: vi.fn() }));
vi.mock("@/components/sync/sync-provider", () => ({ useSyncQueue }));
const NO_QUEUE = {
  records: [],
  inFlight: new Set(),
  justSaved: new Set(),
  block: null,
  syncedVersion: 0,
  ownerId: undefined,
  enqueue: null,
  retry: vi.fn(),
  retryAll: vi.fn(),
};

const BLOCK = "b1";
const noSession = vi.fn((): Promise<OutingAnswer> => Promise.resolve({ kind: "unknown" }));

const summary = (unitNumber: string, id = "h1"): HouseholdSummary => ({
  household: {
    id,
    blockId: BLOCK,
    unitNumber,
    name: "Mr Tan",
    contact: null,
    religion: "buddhist",
    createdAt: "2026-03-14T10:00:00.000Z",
    updatedAt: "2026-03-14T10:00:00.000Z",
  },
  visitCount: 1,
  latestVisit: null,
  outstandingFollowUps: 0,
});

const history = (over: Record<string, unknown> = {}) => ({
  household: summary("#05-123").household,
  block: { id: BLOCK, name: "123", street: "Test Ave", postalCode: null, createdAt: "" },
  visits: [
    {
      id: "v1",
      householdId: "h1",
      sessionId: "s1",
      member: { id: "u2", name: "Ben", image: null },
      interestLevel: "medium",
      description: "Listened for a while.",
      clientCreatedAt: "2026-03-14T10:00:00.000Z",
      createdAt: "2026-03-14T10:00:00.000Z",
      updatedAt: "2026-03-14T10:00:00.000Z",
    },
  ],
  followUps: [],
  ...over,
});

type Late = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };

const body = () =>
  JSON.parse((apiFetch.mock.calls[0]?.[1] as { body: string }).body) as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockResolvedValue({});
  useRole.mockReturnValue({ userId: "u1", isAdmin: false });
  useOnline.mockReturnValue(true);
  useSyncQueue.mockReturnValue(NO_QUEUE);
});

/* A note left on an earlier outing, months before this knock. */
const owed: FollowUp = {
  id: "f1",
  householdId: "h1",
  blockId: "b1",
  blockName: "123",
  unitNumber: "#05-123",
  visitId: null,
  status: "listed",
  author: { id: "u2", name: "Ben", image: null },
  note: "Bring the community event flyer.",
  dueDate: null,
  doneAt: null,
  doneBy: null,
  listedAt: null,
  listedBy: null,
  deletedAt: null,
  deletedBy: null,
  deleteReason: null,
  createdAt: "2025-11-02T10:00:00.000Z",
};

/* A follow-up session covering this block, so a member may resolve its notes. */
const FOLLOW_UP: ActiveSession = {
  session: {
    id: "s9",
    title: "Follow-up",
    kind: "follow_up",
    status: "active",
    startedAt: "2025-01-01T00:00:00.000Z",
    endedAt: null,
    createdBy: { id: "a1", name: "Admin", image: null },
    createdAt: "2025-01-01T00:00:00.000Z",
  },
  blocks: [
    {
      block: { id: BLOCK, name: "123", street: "Test Ave", postalCode: null, createdAt: "" },
      visitCount: 0,
      householdCount: 0,
      activeMembers: [],
    },
  ],
};

describe("validateVisit", () => {
  it("requires a unit number", () => {
    expect(validateVisit("  ", "low").unitNumber).toBe("Enter the unit number.");
  });

  it("requires an interest level", () => {
    expect(validateVisit("#05-123", null).interestLevel).toBe("Choose an interest level.");
  });

  it("accepts a complete minimum", () => {
    expect(validateVisit("#05-123", "no_response")).toEqual({});
  });
});

describe("blockedMessage", () => {
  it("names everything that stopped the save, in one line", () => {
    expect(blockedMessage(validateVisit("", null))).toBe(
      "Not saved. Enter the unit number and choose an interest level.",
    );
    expect(blockedMessage(validateVisit("", "low"))).toBe("Not saved. Enter the unit number.");
    expect(blockedMessage(validateVisit("#05-01", null))).toBe(
      "Not saved. Choose an interest level.",
    );
  });

  it("is silent when nothing is wrong", () => {
    expect(blockedMessage({})).toBeNull();
  });
});

describe("the two-tap path", () => {
  it("records a silent door in two taps once the unit is entered", async () => {
    /*
     * The acceptance criterion, and the difference between a tool people use
     * and one they abandon: most knocks go unanswered, and a full form for
     * every one of them is how recording stops happening.
     */
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Unit number"), "#06-201");
    await user.click(screen.getByRole("radio", { name: "No response" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });
    expect(body()).toMatchObject({ unitNumber: "#06-201", interestLevel: "no_response" });
  });

  it("does not make the member open the optional fields", () => {
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );
    // Hidden until asked for, so the save button is not six fields away.
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add details" })).toBeInTheDocument();
  });

  it("offers interest levels as buttons, not a dropdown", () => {
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );
    for (const label of ["No response", "Low", "Medium", "High"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
  });

  it("sends null for the optional fields left untouched", async () => {
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#06-201");
    await user.click(screen.getByRole("radio", { name: "No response" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalled();
    });
    // Null, not empty strings: the API treats null as "learned nothing".
    expect(body()).toMatchObject({ name: null, contact: null, religion: null });
  });
});

describe("moving along a corridor", () => {
  it("suggests the next unit after saving", async () => {
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Unit number")).toHaveValue("#05-124");
    });
  });

  it("clears the interest level so the next door starts fresh", async () => {
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "High" })).toHaveAttribute("aria-checked", "false");
    });
  });

  it("brings the Saved line and the next unit back into view after each save, and only then", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );
    const save = screen.getByRole("button", { name: "Save and next" });
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    // Refused: the reason is beside Save, where the member is looking.
    await user.click(save);
    expect(screen.getByRole("alert")).toHaveTextContent("Choose an interest level");
    expect(scrolled).not.toHaveBeenCalled();

    apiFetch
      .mockResolvedValueOnce({ id: "v1", householdId: "h1" })
      .mockResolvedValueOnce({ id: "v2", householdId: "h2" });
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(save);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Saved #05-123.");
    });
    expect(scrolled).toHaveBeenCalledOnce();
    expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
    const brought = scrolled.mock.contexts[0] as HTMLElement;
    expect(brought).toContainElement(screen.getByRole("status"));
    expect(brought).toContainElement(screen.getByLabelText("Unit number"));
    expect(brought).toHaveClass("scroll-clear-chrome");

    // The next door, already filled in.
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(save);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Saved #05-124.");
    });
    expect(scrolled).toHaveBeenCalledTimes(2);
    scrolled.mockRestore();
  });

  it("leaves the field empty when the unit has no obvious successor", async () => {
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "Penthouse");
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Unit number")).toHaveValue("");
    });
  });

  it("tells the block screen to refresh its unit list", async () => {
    const onRecorded = vi.fn();
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={onRecorded}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    await waitFor(() => {
      expect(onRecorded).toHaveBeenCalled();
    });
  });
});

describe("history before knocking", () => {
  it("shows what is known once the unit matches one recorded before", async () => {
    /*
     * The whole reason the household/visit split exists: arrive at the door
     * already knowing what was said last time.
     */
    apiFetch.mockResolvedValue(history());
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[summary("#05-123")]}
        onRecorded={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    expect(await screen.findByText("Mr Tan")).toBeInTheDocument();
    expect(screen.getByText("Listened for a while.")).toBeInTheDocument();
  });

  it("surfaces outstanding follow-ups prominently", async () => {
    apiFetch.mockResolvedValue(history({ followUps: [owed] }));
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[summary("#05-123")]}
        onRecorded={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#05-123");

    const list = within(await screen.findByRole("list", { name: "On the follow-up list" }));
    expect(list.getByText("Bring the community event flyer.")).toBeInTheDocument();
    expect(list.getByText(/Added by Ben · 2 Nov 2025/)).toBeInTheDocument();
  });

  it("lets a note be marked done at the door, then re-reads the unit", async () => {
    let resolved = false;
    apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === "PATCH") {
        resolved = true;
        return Promise.resolve({});
      }
      return Promise.resolve(
        history({
          followUps: [
            resolved
              ? {
                  ...owed,
                  doneAt: "2026-10-14T00:00:00.000Z",
                  doneBy: { id: "u1", name: "Me", image: null },
                }
              : owed,
          ],
        }),
      );
    });
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[summary("#05-123")]}
        active={FOLLOW_UP}
        onRecorded={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(await screen.findByRole("button", { name: "Mark done" }));

    const timeline = within(await screen.findByRole("list", { name: "Timeline" }));
    expect(await timeline.findByText("Follow-up done")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "On the follow-up list" })).not.toBeInTheDocument();
    expect(apiFetch.mock.calls.filter(([path]) => path === "/households/h1")).toHaveLength(2);
  });

  it("keeps a resolved note to one line with no controls, so the picker stays near", async () => {
    const done = {
      ...owed,
      doneAt: "2026-01-02T00:00:00.000Z",
      doneBy: { id: "u2", name: "Ben", image: null },
    };
    apiFetch.mockResolvedValue(history({ followUps: [done] }));
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[summary("#05-123")]}
        onRecorded={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#05-123");

    const timeline = within(await screen.findByRole("list", { name: "Timeline" }));
    expect(
      timeline.getByText("Bring the community event flyer.", { exact: false }),
    ).toBeInTheDocument();
    expect(timeline.queryByText(/Added by/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("keeps the unit on screen when the re-read after marking done fails", async () => {
    let reads = 0;
    apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === "PATCH") return Promise.resolve({});
      reads += 1;
      return reads === 1
        ? Promise.resolve(history({ followUps: [owed] }))
        : Promise.reject(new TypeError("Failed to fetch"));
    });
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[summary("#05-123")]}
        active={FOLLOW_UP}
        onRecorded={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(await screen.findByRole("button", { name: "Mark done" }));

    await waitFor(() => {
      expect(reads).toBe(2);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByRole("region", { name: "What we know about this unit" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Mr Tan")).toBeInTheDocument();
    expect(screen.getByText("Listened for a while.")).toBeInTheDocument();
  });

  it("drops the last unit's history when a different unit's lookup fails", async () => {
    apiFetch.mockImplementation((path: string) =>
      path === "/households/h1"
        ? Promise.resolve(history())
        : Promise.reject(new TypeError("Failed to fetch")),
    );
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[summary("#05-123"), summary("#05-125", "h2")]}
        onRecorded={vi.fn()}
      />,
    );
    const unit = screen.getByLabelText("Unit number");
    await user.type(unit, "#05-123");
    expect(await screen.findByText("Mr Tan")).toBeInTheDocument();

    // Straight from one known unit to the next, never through an unknown one.
    fireEvent.change(unit, { target: { value: "#05-125" } });
    await waitFor(() => {
      expect(screen.queryByText("Mr Tan")).not.toBeInTheDocument();
    });
  });

  /* A promise settles once, so the late answer and the late failure each
     need their own first lookup. */
  it.each([
    [
      "answer",
      (late: Late) => {
        late.resolve(history());
      },
    ],
    [
      "failure",
      (late: Late) => {
        late.reject(new TypeError("Failed to fetch"));
      },
    ],
  ])(
    "never lets a late %s for a unit already passed replace the unit now typed",
    async (_, settle) => {
      const late: Late = { resolve: () => undefined, reject: () => undefined };
      const lee = { ...summary("#05-125", "h2").household, name: "Mdm Lee" };
      apiFetch.mockImplementation((path: string) =>
        path === "/households/h1"
          ? new Promise((resolve, reject) => {
              late.resolve = resolve;
              late.reject = reject;
            })
          : Promise.resolve(history({ household: lee })),
      );
      render(
        <RecordVisitForm
          sessionId={null}
          loadSession={noSession}
          blockId={BLOCK}
          known={[summary("#05-123"), summary("#05-125", "h2")]}
          onRecorded={vi.fn()}
        />,
      );
      const unit = screen.getByLabelText("Unit number");
      fireEvent.change(unit, { target: { value: "#05-123" } });
      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith("/households/h1");
      });
      fireEvent.change(unit, { target: { value: "#05-125" } });
      expect(await screen.findByText("Mdm Lee")).toBeInTheDocument();

      await act(async () => {
        settle(late);
        await Promise.resolve();
      });
      expect(screen.getByText("Mdm Lee")).toBeInTheDocument();
      expect(screen.queryByText("Mr Tan")).not.toBeInTheDocument();
    },
  );

  it("matches a unit typed without the hash", async () => {
    apiFetch.mockResolvedValue(history());
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[summary("#05-123")]}
        onRecorded={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "05-123");
    expect(await screen.findByText("Mr Tan")).toBeInTheDocument();
  });

  it("shows nothing for a unit never visited", async () => {
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[summary("#05-123")]}
        onRecorded={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#09-999");
    await waitFor(() => {
      expect(screen.queryByText("Mr Tan")).not.toBeInTheDocument();
    });
  });

  it("still lets the member record when the history lookup fails", async () => {
    // A failed lookup must never block the actual job.
    apiFetch.mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[summary("#05-123")]}
        onRecorded={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save and next" })).toBeEnabled();
    });
  });
});

describe("a follow-up after saving", () => {
  const saveVisit = async () => {
    apiFetch.mockResolvedValueOnce({ id: "v-new", householdId: "h-new" });
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#06-201");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));
    return user;
  };

  it("offers a member a suggestion, anchored to the visit just saved", async () => {
    const user = await saveVisit();
    expect(await screen.findByRole("status")).toHaveTextContent("Saved #06-201.");
    await user.click(screen.getByRole("button", { name: "Suggest a return visit" }));

    const sheet = screen.getByRole("dialog", { name: "Suggest a return visit, #06-201" });
    await user.type(within(sheet).getByLabelText("Why should we go back?"), "Call on Sunday");
    await user.click(within(sheet).getByRole("button", { name: "Send suggestion" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/follow-ups", {
        method: "POST",
        body: JSON.stringify({
          householdId: "h-new",
          visitId: "v-new",
          note: "Call on Sunday",
          dueDate: null,
        }),
      });
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Saved #06-201. Suggestion sent. An admin will review it.",
    );
    expect(
      screen.queryByRole("button", { name: "Suggest a return visit" }),
    ).not.toBeInTheDocument();
  });

  it("offers an admin the follow-up list itself", async () => {
    useRole.mockReturnValue({ userId: "a1", isAdmin: true });
    const user = await saveVisit();
    await user.click(await screen.findByRole("button", { name: "Add to follow-up list" }));
    const sheet = screen.getByRole("dialog", { name: "Add to the follow-up list, #06-201" });
    await user.type(within(sheet).getByLabelText("What should the next visit do?"), "Flyer");
    await user.click(within(sheet).getByRole("button", { name: "Add to list" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Saved #06-201. Added to the follow-up list.",
      );
    });
  });

  it("can be dismissed without adding anything", async () => {
    const user = await saveVisit();
    await user.click(await screen.findByRole("button", { name: "Suggest a return visit" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suggest a return visit" })).toBeInTheDocument();
  });

  it("clears once the next unit is typed", async () => {
    await saveVisit();
    await screen.findByRole("status");
    fireEvent.change(screen.getByLabelText("Unit number"), { target: { value: "#06-205" } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("is not offered when the save fails", async () => {
    apiFetch.mockRejectedValueOnce(new Error("Server unavailable"));
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#06-201");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "Save and next" }));
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Suggest a return visit" }),
    ).not.toBeInTheDocument();
  });
});

describe("what a save offers for a household with a note already", () => {
  const waiting: FollowUp = { ...owed, id: "s1", status: "suggested" };

  /* Answers the unit's history with `notes`, and a save with its visit. */
  const recordAt = async (notes: FollowUp[]) => {
    apiFetch.mockImplementation((path: string, init?: { method?: string }) =>
      Promise.resolve(
        init?.method === undefined
          ? history({ followUps: notes })
          : path === "/visits"
            ? { id: "v-new", householdId: "h1" }
            : {},
      ),
    );
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[summary("#05-123")]}
        onRecorded={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await screen.findByText("Mr Tan");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Saved #05-123.");
    return { user, status };
  };

  it.each([
    ["already on the list", [owed]],
    ["waiting for review", [waiting]],
  ])(
    "offers a member no suggestion for a household %s, which the server would refuse",
    async (_case, notes) => {
      const { status } = await recordAt(notes);
      expect(within(status).queryByRole("button")).toBeNull();
    },
  );

  it("offers an admin nothing more for a household already on the list", async () => {
    useRole.mockReturnValue({ userId: "a1", isAdmin: true });
    const { status } = await recordAt([owed]);
    expect(within(status).queryByRole("button")).toBeNull();
  });

  it("has an admin list the waiting suggestion, not add a second note beside it", async () => {
    useRole.mockReturnValue({ userId: "a1", isAdmin: true });
    const { user, status } = await recordAt([waiting]);
    await user.click(within(status).getByRole("button", { name: "Add to follow-up list" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Saved #05-123. Added to the follow-up list.",
      );
    });
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups/s1", {
      method: "PATCH",
      body: JSON.stringify({ status: "listed" }),
    });
    expect(apiFetch).not.toHaveBeenCalledWith("/follow-ups", expect.anything());
  });
});

describe("validation and failure", () => {
  it("shows inline errors and does not call the API", async () => {
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    expect(await screen.findByText("Enter the unit number.")).toBeInTheDocument();
    expect(screen.getByText("Choose an interest level.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("says beside Save why it did nothing, when the field at fault is scrolled away", async () => {
    // Notes typed with the details open push the picker off screen; a Save
    // that silently refuses is a visit lost at the next door.
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("button", { name: "Add details" }));
    await user.type(screen.getByLabelText("Notes"), "Asked us back on Sunday.");
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Not saved. Choose an interest level.");
    expect(screen.getByRole("button", { name: "Save and next" }).parentElement).toContainElement(
      alert,
    );
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("clears each error the moment its field is fixed", async () => {
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save and next" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Not saved. Enter the unit number and choose an interest level.",
    );

    await user.click(screen.getByRole("radio", { name: "Low" }));
    expect(screen.queryByText("Choose an interest level.")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Not saved. Enter the unit number.");

    await user.type(screen.getByLabelText("Unit number"), "#05-1");
    expect(screen.queryByText("Enter the unit number.")).toBeNull();
    expect(screen.getByLabelText("Unit number")).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks for the unit when it is left empty, before any Save", async () => {
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );
    await user.click(screen.getByLabelText("Unit number"));
    await user.tab();
    expect(screen.getByText("Enter the unit number.")).toBeInTheDocument();
    // The summary beside Save belongs to a refused Save, not to a blur.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("marks the invalid field for assistive tech", async () => {
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save and next" }));
    expect(screen.getByLabelText("Unit number")).toHaveAttribute("aria-invalid", "true");
  });

  it("reports a failure without losing what was typed", async () => {
    // Retyping a description at the door is exactly what loses records.
    apiFetch.mockRejectedValue(new Error("No session is active."));
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No session is active.");
    expect(screen.getByLabelText("Unit number")).toHaveValue("#05-123");
  });

  it("reports a failure that gives no reason in plain words", async () => {
    apiFetch.mockRejectedValue("boom");
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save this visit.");
    expect(screen.getByLabelText("Unit number")).toHaveValue("#05-123");
  });
});

describe("optional details", () => {
  it("sends them when filled in", async () => {
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Add details" }));
    await user.type(screen.getByLabelText("Name"), "Mrs Lee");
    await user.type(screen.getByLabelText("Contact"), "+65 9000 0000");
    await user.selectOptions(screen.getByLabelText("Religion"), "christian");
    await user.type(screen.getByLabelText("Notes"), "Asked for a callback.");
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalled();
    });
    expect(body()).toMatchObject({
      name: "Mrs Lee",
      contact: "+65 9000 0000",
      religion: "christian",
      description: "Asked for a callback.",
    });
  });

  it("collapses again", async () => {
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add details" }));
    await user.click(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });
});

describe("the visit id", () => {
  it("is generated by the client as a UUIDv7", async () => {
    // What makes a retry idempotent, and why the schema has no default.
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalled();
    });
    const id = body()["id"] as string;
    expect(id.split("-")[2]?.[0]).toBe("7");
  });
});

describe("saving into the offline queue", () => {
  const SESSION = "0190a000-0000-7000-8000-0000000000cc";

  /* A queue the test drives by hand: what it holds, and what is in flight. */
  function withQueue(enqueue = vi.fn((draft: VisitDraft) => Promise.resolve(stored(draft)))) {
    const queue = {
      ...NO_QUEUE,
      ownerId: "u1",
      enqueue,
      records: [] as QueuedVisit[],
      inFlight: new Set<string>(),
    };
    useSyncQueue.mockImplementation(() => queue);
    return queue;
  }

  const stored = (draft: VisitDraft): QueuedVisit => ({
    ...buildQueuedVisit(draft, "u1", Date.parse("2026-10-15T10:00:00.000Z"), () => "v-queued"),
  });

  const fill = async () => {
    const user = userEvent.setup();
    const view = render(
      <RecordVisitForm
        sessionId={SESSION}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={onRecorded}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#06-201");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));
    return { user, view };
  };

  const onRecorded = vi.fn();
  const rerenderForm = (view: ReturnType<typeof render>) => {
    view.rerender(
      <RecordVisitForm
        sessionId={SESSION}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={onRecorded}
      />,
    );
  };

  it("saves to the phone without touching the network, and moves on", async () => {
    const queue = withQueue();
    await fill();

    await waitFor(() => {
      expect(queue.enqueue).toHaveBeenCalledWith({
        blockId: BLOCK,
        unitNumber: "#06-201",
        interestLevel: "high",
        description: "",
        name: "",
        contact: "",
        religion: "",
        sessionId: SESSION,
      });
    });
    expect(apiFetch).not.toHaveBeenCalledWith("/visits", expect.anything());
    expect(screen.getByLabelText("Unit number")).toHaveValue("#06-202");
    expect(screen.getByRole("status")).toHaveTextContent(/^Saved #06-201 on this phone\.$/);
    // No note can be anchored to a visit the server has not got yet (D-33-11).
    expect(screen.queryByRole("button", { name: "Add follow-up" })).not.toBeInTheDocument();
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it("says sending while the record is on its way", async () => {
    const queue = withQueue();
    const { view } = await fill();
    await screen.findByRole("status");
    queue.inFlight = new Set(["v-queued"]);
    rerenderForm(view);
    expect(screen.getByRole("status")).toHaveTextContent("Sending #06-201…");
  });

  it("says plainly when the server would not take it", async () => {
    const queue = withQueue();
    const { view } = await fill();
    await screen.findByRole("status");
    queue.records = [{ ...stored(draftFor("#06-201")), state: "held", nextAttemptAt: null }];
    rerenderForm(view);
    expect(screen.getByRole("status")).toHaveTextContent("Saved #06-201 on this phone. Not sent.");
  });

  it("offers a follow-up once sent, anchored to the server's row", async () => {
    const queue = withQueue();
    const { user, view } = await fill();
    await screen.findByRole("status");

    queue.records = [
      {
        ...stored(draftFor("#06-201")),
        state: "synced",
        serverVisit: { ...visitRow, id: "v-queued", householdId: "h-server" },
      },
    ];
    rerenderForm(view);
    expect(screen.getByRole("status")).toHaveTextContent("Saved #06-201.");

    await user.click(screen.getByRole("button", { name: "Suggest a return visit" }));
    const sheet = screen.getByRole("dialog", { name: "Suggest a return visit, #06-201" });
    await user.type(within(sheet).getByLabelText("Why should we go back?"), "Call on Sunday");
    await user.click(within(sheet).getByRole("button", { name: "Send suggestion" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/follow-ups", {
        method: "POST",
        body: JSON.stringify({
          householdId: "h-server",
          visitId: "v-queued",
          note: "Call on Sunday",
          dueDate: null,
        }),
      });
    });
  });

  it("asks again which outing is running when the page never learnt it", async () => {
    const queue = withQueue();
    const user = userEvent.setup();
    const loadSession = vi.fn((): Promise<OutingAnswer> =>
      Promise.resolve({ kind: "running", id: SESSION }),
    );
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={loadSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={onRecorded}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#06-201");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    await waitFor(() => {
      expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SESSION }));
    });
    expect(loadSession).toHaveBeenCalledTimes(1);
  });

  it("never queues a visit without its outing, and keeps everything typed", async () => {
    // Sent later it would join whichever outing is running then, restamped.
    const queue = withQueue();
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={onRecorded}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#06-201");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load the session, so this visit is not saved yet.",
    );
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalledWith("/visits", expect.anything());
    expect(screen.getByLabelText("Unit number")).toHaveValue("#06-201");
    expect(screen.getByRole("radio", { name: "High" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Save and next" })).toBeEnabled();
  });

  it("says so when no outing is running, rather than blaming the signal", async () => {
    const queue = withQueue();
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={() => Promise.resolve({ kind: "none" })}
        blockId={BLOCK}
        known={[]}
        onRecorded={onRecorded}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#06-201");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No session is running, so this visit is not saved yet.");
    expect(alert).not.toHaveTextContent("signal");
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Unit number")).toHaveValue("#06-201");
  });

  it("shows a failed save beside the Save button, where the member is looking", async () => {
    /* With the details open the top of the form is scrolled away; the sticky
       bar holding Save is the one place sure to be on screen. */
    withQueue();
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={onRecorded}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#06-201");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Add details" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    const alert = await screen.findByRole("alert");
    const bar = screen.getByRole("button", { name: "Save and next" }).parentElement;
    expect(bar).toHaveClass("sticky");
    expect(bar).toContainElement(alert);
  });

  it("stops waiting for an outing that stalls, so the member can try again", async () => {
    // Weak signal stalls a request rather than failing it (D-33-10).
    const queue = withQueue();
    const user = userEvent.setup();
    const stalled = vi.fn(() => new Promise<OutingAnswer>(() => undefined));
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={stalled}
        blockId={BLOCK}
        known={[]}
        onRecorded={onRecorded}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#06-201");
    await user.click(screen.getByRole("radio", { name: "High" }));

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
      await act(() => vi.advanceTimersByTimeAsync(OUTING_ASK_TIMEOUT_MS - 1));
      expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();

      await act(() => vi.advanceTimersByTimeAsync(1));
    } finally {
      vi.useRealTimers();
    }

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load the session, so this visit is not saved yet.",
    );
    expect(screen.getByRole("button", { name: "Save and next" })).toBeEnabled();
    expect(screen.getByLabelText("Unit number")).toHaveValue("#06-201");
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("goes straight to the server when the phone cannot store it", async () => {
    withQueue(vi.fn(() => Promise.reject(new DOMException("full", "QuotaExceededError"))));
    apiFetch.mockResolvedValueOnce({ id: "v-direct", householdId: "h-direct" });
    await fill();

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/visits", expect.anything());
    });
    expect(body()).toMatchObject({ unitNumber: "#06-201", interestLevel: "high", name: null });
    expect(body()).not.toHaveProperty("sessionId");
    expect(await screen.findByRole("status")).toHaveTextContent("Saved #06-201.");
    expect(onRecorded).toHaveBeenCalled();
  });

  it("keeps everything typed when neither the phone nor the server takes it", async () => {
    withQueue(vi.fn(() => Promise.reject(new Error("private mode"))));
    apiFetch.mockRejectedValueOnce(new Error("Failed to fetch"));
    await fill();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Failed to fetch");
    expect(screen.getByRole("button", { name: "Save and next" }).parentElement).toContainElement(
      alert,
    );
    expect(screen.getByLabelText("Unit number")).toHaveValue("#06-201");
    expect(screen.getByRole("radio", { name: "High" })).toBeChecked();
  });
});

const draftFor = (unitNumber: string): VisitDraft => ({
  blockId: BLOCK,
  unitNumber,
  interestLevel: "high",
  description: "",
  name: "",
  contact: "",
  religion: "",
  sessionId: "0190a000-0000-7000-8000-0000000000cc",
});

const visitRow = {
  id: "v",
  householdId: "h",
  sessionId: "s",
  member: { id: "u1", name: "Ann" },
  team: null,
  interestLevel: "high" as const,
  description: "",
  clientCreatedAt: "2026-10-15T10:00:00.000Z",
  createdAt: "2026-10-15T10:00:00.000Z",
  updatedAt: "2026-10-15T10:00:00.000Z",
};

/* The offline shell asks before leaving a form with input (#77). */
describe("telling the page whether anything would be lost", () => {
  function mountDirty() {
    const onDirtyChange = vi.fn();
    const view = render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );
    return { onDirtyChange, view, last: () => onDirtyChange.mock.calls.at(-1)?.[0] as unknown };
  }

  it("is clean when empty, and dirty once a unit is typed", async () => {
    const user = userEvent.setup();
    const { last } = mountDirty();
    expect(last()).toBe(false);
    await user.type(screen.getByLabelText("Unit number"), "#05-1");
    expect(last()).toBe(true);
    await user.clear(screen.getByLabelText("Unit number"));
    expect(last()).toBe(false);
  });

  it.each([
    [
      "an interest level",
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(screen.getByRole("radio", { name: "Low" }));
      },
    ],
    [
      "a note",
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(screen.getByRole("button", { name: "Add details" }));
        await user.type(screen.getByLabelText("Notes"), "Come back");
      },
    ],
    [
      "a religion",
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(screen.getByRole("button", { name: "Add details" }));
        await user.selectOptions(screen.getByLabelText("Religion"), "hindu");
      },
    ],
  ])("is dirty with %s chosen", async (_, fill) => {
    const user = userEvent.setup();
    const { last } = mountDirty();
    await fill(user);
    expect(last()).toBe(true);
  });

  it("is clean after a save, though the next unit is filled in for them", async () => {
    apiFetch.mockResolvedValue({ id: "v1", householdId: "h1" });
    const user = userEvent.setup();
    const { last } = mountDirty();
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Unit number")).toHaveValue("#05-124");
    });
    expect(last()).toBe(false);

    await user.type(screen.getByLabelText("Unit number"), "A");
    expect(last()).toBe(true);
  });

  it("says clean once the form is gone", async () => {
    const user = userEvent.setup();
    const { last, view } = mountDirty();
    await user.type(screen.getByLabelText("Unit number"), "#05-1");
    view.unmount();
    expect(last()).toBe(false);
  });
});

describe("in a follow-up session", () => {
  const revisit = (unitNumber: string, { done = false, visited = false } = {}) => ({
    household: { ...summary(unitNumber, `h${unitNumber}`).household },
    block: { id: BLOCK, name: "123", street: "Test Ave", postalCode: null, createdAt: "" },
    notes: [{ ...owed, id: `n${unitNumber}`, doneAt: done ? "2026-10-20T10:00:00.000Z" : null }],
    latestVisit: null,
    visitedInSession: visited,
  });
  const LIST = [
    revisit("#05-123"),
    revisit("#06-201", { visited: true }),
    revisit("#07-301", { done: true }),
  ];

  const mount = (
    revisits: ReturnType<typeof revisit>[] | null = LIST,
    known: HouseholdSummary[] = [],
    initialUnit?: string,
  ) =>
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={known}
        followUp={{ revisits }}
        onRecorded={vi.fn()}
        {...(initialUnit === undefined ? {} : { initialUnit })}
      />,
    );

  it("offers the block's listed units as chips that fill in the unit", async () => {
    const user = userEvent.setup();
    mount();
    const chips = within(screen.getByRole("list", { name: "On the list in this block" }));
    expect(chips.getAllByRole("button").map((chip) => chip.textContent)).toEqual([
      "#05-123",
      "#06-201 · Visited",
      "#07-301 · Done",
    ]);
    await user.click(chips.getByRole("button", { name: "#06-201 · Visited" }));
    expect(screen.getByLabelText("Unit number")).toHaveValue("#06-201");
    expect(chips.getByRole("button", { name: "#06-201 · Visited" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("explains an unlisted unit and refuses to save it, beside Save", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Unit number"), "05-124");
    expect(screen.getByLabelText("Unit number")).toHaveAccessibleDescription(
      "#05-124 is not on the follow-up list, so it can't be recorded in this session. Ask an admin to add it.",
    );
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Not saved. This unit is not on the follow-up list.",
    );
    expect(apiFetch).not.toHaveBeenCalledWith("/visits", expect.anything());
  });

  it("lifts the refusal once a listed unit is chosen", async () => {
    apiFetch.mockResolvedValue({ id: "v1", householdId: "h#05-123" });
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Unit number"), "#05-124");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "#05-123" }));
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved #05-123.");
  });

  it("lets a member suggest a known, unlisted household from the refusal", async () => {
    apiFetch.mockImplementation((path: string, init?: { method?: string }) =>
      Promise.resolve(
        init?.method === "POST" ? {} : history({ household: summary("#05-124", "h9").household }),
      ),
    );
    const user = userEvent.setup();
    mount(LIST, [summary("#05-124", "h9")]);
    await user.type(screen.getByLabelText("Unit number"), "#05-124");
    await user.click(await screen.findByRole("button", { name: "Suggest a return visit" }));
    const sheet = within(screen.getByRole("dialog", { name: "Suggest a return visit, #05-124" }));
    await user.type(sheet.getByLabelText("Why should we go back?"), "Wants a visit");
    await user.click(sheet.getByRole("button", { name: "Send suggestion" }));
    expect(
      await screen.findByText("Suggestion sent. An admin will review it."),
    ).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/follow-ups", {
      method: "POST",
      body: JSON.stringify({
        householdId: "h9",
        visitId: null,
        note: "Wants a visit",
        dueDate: null,
      }),
    });
  });

  it("closes the suggestion from the refusal on Cancel, leaving it on offer", async () => {
    apiFetch.mockResolvedValue(history({ household: summary("#05-124", "h9").household }));
    const user = userEvent.setup();
    mount(LIST, [summary("#05-124", "h9")]);
    await user.type(screen.getByLabelText("Unit number"), "#05-124");
    await user.click(await screen.findByRole("button", { name: "Suggest a return visit" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Suggest a return visit" })).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith("/follow-ups", expect.anything());
  });

  it("offers no suggestion for a household already waiting for review", async () => {
    apiFetch.mockResolvedValue(
      history({
        household: summary("#05-124", "h9").household,
        followUps: [{ ...owed, status: "suggested" }],
      }),
    );
    const user = userEvent.setup();
    mount(LIST, [summary("#05-124", "h9")]);
    await user.type(screen.getByLabelText("Unit number"), "#05-124");
    expect(await screen.findByRole("list", { name: "Waiting for review" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suggest a return visit" })).toBeNull();
  });

  it("tells an admin the unit is off the list, and records it anyway", async () => {
    useRole.mockReturnValue({ userId: "a1", isAdmin: true });
    apiFetch.mockResolvedValue({ id: "v1", householdId: "h1" });
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Unit number"), "#05-124");
    expect(screen.getByLabelText("Unit number")).toHaveAccessibleDescription(
      "Not on the follow-up list. You can still record it as an admin.",
    );
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved #05-124.");
  });

  it("says when the list could not be checked, and still saves", async () => {
    apiFetch.mockResolvedValue({ id: "v1", householdId: "h1" });
    const user = userEvent.setup();
    mount(null);
    expect(screen.queryByRole("list", { name: "On the list in this block" })).toBeNull();
    await user.type(screen.getByLabelText("Unit number"), "#05-124");
    expect(screen.getByLabelText("Unit number")).toHaveAccessibleDescription(
      "Could not check the follow-up list. A visit to a unit not on it will wait on this phone until an admin adds it.",
    );
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved #05-124.");
  });

  it("guesses no next unit after a save, and offers the way back to the list", async () => {
    apiFetch.mockResolvedValue({ id: "v1", householdId: "h1" });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "#05-123" }));
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Saved #05-123.");
    expect(within(status).getByRole("link", { name: "Back to the list" })).toHaveAttribute(
      "href",
      "/",
    );
    // The household is listed already: a member has nothing to suggest here.
    expect(within(status).queryByRole("button")).toBeNull();
    expect(screen.getByLabelText("Unit number")).toHaveValue("");
    // Nothing comes next by itself, so the button promises no "next".
    expect(screen.queryByRole("button", { name: "Save and next" })).toBeNull();
  });

  it("explains a refusal from the server in the same words", async () => {
    apiFetch.mockRejectedValue(
      new ApiRequestError(409, {
        error: { code: "not_on_follow_up_list", message: "raw server text" },
      }),
    );
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "#05-123" }));
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Not saved. This unit is not on the follow-up list.",
    );
  });

  it("arrives with a unit picked from the list, which counts as nothing typed", () => {
    const onDirtyChange = vi.fn();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        followUp={{ revisits: LIST }}
        initialUnit="#06-201"
        onRecorded={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );
    expect(screen.getByLabelText("Unit number")).toHaveValue("#06-201");
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  describe("with a list that may have moved on", () => {
    const ADDED = [...LIST, revisit("#05-124")];

    const mountWith = (
      revisits: ReturnType<typeof revisit>[] | null | undefined,
      recheck: () => Promise<ReturnType<typeof revisit>[] | null>,
    ) =>
      render(
        <RecordVisitForm
          sessionId={null}
          loadSession={noSession}
          blockId={BLOCK}
          known={[]}
          followUp={{ revisits, recheck }}
          onRecorded={vi.fn()}
        />,
      );

    const postedVisits = () => apiFetch.mock.calls.filter(([path]) => path === "/visits");

    it("asks for the list again before refusing, and saves a unit an admin has just added", async () => {
      // The refusal told the member to ask an admin; the admin did.
      apiFetch.mockResolvedValue({ id: "v1", householdId: "h#05-124" });
      const recheck = vi.fn(() => Promise.resolve(ADDED));
      const user = userEvent.setup();
      mountWith(LIST, recheck);
      await user.type(screen.getByLabelText("Unit number"), "#05-124");
      expect(screen.getByText(/is not on the follow-up list/)).toBeVisible();
      await user.click(screen.getByRole("radio", { name: "High" }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByRole("status")).toHaveTextContent("Saved #05-124.");
      expect(recheck).toHaveBeenCalledTimes(1);
      expect(postedVisits()).toHaveLength(1);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("refuses once the list read again still leaves the unit off", async () => {
      const recheck = vi.fn(() => Promise.resolve(LIST));
      const user = userEvent.setup();
      mountWith(LIST, recheck);
      await user.type(screen.getByLabelText("Unit number"), "#05-124");
      await user.click(screen.getByRole("radio", { name: "High" }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(OFF_THE_LIST);
      expect(recheck).toHaveBeenCalledTimes(1);
      expect(postedVisits()).toHaveLength(0);
      expect(screen.getByLabelText("Unit number")).toHaveValue("#05-124");
    });

    it("judges by the list on screen when it cannot be read again", async () => {
      const recheck = vi.fn(() => Promise.resolve(null));
      const user = userEvent.setup();
      mountWith(LIST, recheck);
      await user.type(screen.getByLabelText("Unit number"), "#05-124");
      await user.click(screen.getByRole("radio", { name: "High" }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(OFF_THE_LIST);
      expect(postedVisits()).toHaveLength(0);
    });

    it("does not ask again for a unit already on the list", async () => {
      apiFetch.mockResolvedValue({ id: "v1", householdId: "h#05-123" });
      const recheck = vi.fn(() => Promise.resolve(LIST));
      const user = userEvent.setup();
      mountWith(LIST, recheck);
      await user.click(screen.getByRole("button", { name: "#05-123" }));
      await user.click(screen.getByRole("radio", { name: "High" }));
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("status")).toHaveTextContent("Saved #05-123.");
      expect(recheck).not.toHaveBeenCalled();
    });

    it("says nothing about the list while it is first read, and a save waits for it", async () => {
      // An ordinary load on weak signal is not a failure to warn about.
      let answer: (list: ReturnType<typeof revisit>[] | null) => void = () => undefined;
      const recheck = vi.fn(
        () =>
          new Promise<ReturnType<typeof revisit>[] | null>((resolve) => {
            answer = resolve;
          }),
      );
      const user = userEvent.setup();
      mountWith(undefined, recheck);
      await user.type(screen.getByLabelText("Unit number"), "#05-124");
      expect(screen.queryByText(/Could not check the follow-up list/)).toBeNull();
      expect(screen.queryByText(/is not on the follow-up list/)).toBeNull();
      expect(screen.getByLabelText("Unit number")).not.toHaveAccessibleDescription();

      await user.click(screen.getByRole("radio", { name: "High" }));
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
      expect(postedVisits()).toHaveLength(0);

      answer(LIST);
      expect(await screen.findByRole("alert")).toHaveTextContent(OFF_THE_LIST);
      expect(postedVisits()).toHaveLength(0);
    });

    it("saves while the list is still unknown once it cannot be read, leaving the server to judge", async () => {
      apiFetch.mockResolvedValue({ id: "v1", householdId: "h9" });
      const recheck = vi.fn(() => Promise.resolve(null));
      const user = userEvent.setup();
      mountWith(undefined, recheck);
      await user.type(screen.getByLabelText("Unit number"), "#05-124");
      await user.click(screen.getByRole("radio", { name: "High" }));
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("status")).toHaveTextContent("Saved #05-124.");
      expect(postedVisits()).toHaveLength(1);
    });

    it("lets an admin save at once while the list is first read", async () => {
      useRole.mockReturnValue({ userId: "a1", isAdmin: true });
      apiFetch.mockResolvedValue({ id: "v1", householdId: "h9" });
      const recheck = vi.fn(() => new Promise<null>(() => undefined));
      const user = userEvent.setup();
      mountWith(undefined, recheck);
      await user.type(screen.getByLabelText("Unit number"), "#05-124");
      await user.click(screen.getByRole("radio", { name: "High" }));
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("status")).toHaveTextContent("Saved #05-124.");
      expect(recheck).not.toHaveBeenCalled();
    });

    it("saves one visit for two taps while the list is read again", async () => {
      apiFetch.mockResolvedValue({ id: "v1", householdId: "h#05-124" });
      let answer: (list: ReturnType<typeof revisit>[] | null) => void = () => undefined;
      const recheck = vi.fn(
        () =>
          new Promise<ReturnType<typeof revisit>[] | null>((resolve) => {
            answer = resolve;
          }),
      );
      const user = userEvent.setup();
      mountWith(LIST, recheck);
      await user.type(screen.getByLabelText("Unit number"), "#05-124");
      await user.click(screen.getByRole("radio", { name: "High" }));
      const form = screen.getByLabelText("Unit number").closest("form");
      if (form === null) throw new Error("expected the form");
      fireEvent.submit(form);
      fireEvent.submit(form);
      answer(ADDED);
      expect(await screen.findByRole("status")).toHaveTextContent("Saved #05-124.");
      expect(recheck).toHaveBeenCalledTimes(1);
      expect(postedVisits()).toHaveLength(1);
    });
  });
});
