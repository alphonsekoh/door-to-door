import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiClientModule from "@/lib/api-client";
import { RecordVisitForm, blockedMessage, validateVisit } from "@/components/record-visit-form";
import type { HouseholdSummary } from "@/generated/types.gen";
import { type VisitDraft, buildQueuedVisit } from "@/lib/sync/enqueue";
import { OUTING_ASK_TIMEOUT_MS, type OutingAnswer } from "@/lib/sync/outing";
import type { QueuedVisit } from "@/lib/sync/types";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/use-role", () => ({ useRole }));

const { useOnline } = vi.hoisted(() => ({ useOnline: vi.fn() }));
vi.mock("@/lib/use-online", () => ({ useOnline }));

/* Unavailable unless a test says otherwise: these tests describe the direct
   save, which is what runs when the queue cannot be opened. */
const { useSyncQueue } = vi.hoisted(() => ({ useSyncQueue: vi.fn() }));
vi.mock("@/components/sync-provider", () => ({ useSyncQueue }));
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
const owed = {
  id: "f1",
  householdId: "h1",
  blockName: "123",
  unitNumber: "#05-123",
  visitId: null,
  author: { id: "u2", name: "Ben", image: null },
  note: "Bring the community event flyer.",
  dueDate: null,
  doneAt: null,
  doneBy: null,
  createdAt: "2025-11-02T10:00:00.000Z",
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

    expect(await screen.findByText("Outstanding follow-up")).toBeInTheDocument();
    const list = within(screen.getByRole("list", { name: "Outstanding follow-ups" }));
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
        onRecorded={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(await screen.findByRole("button", { name: "Mark done" }));

    const timeline = within(await screen.findByRole("list", { name: "Timeline" }));
    expect(await timeline.findByText("Follow-up done")).toBeInTheDocument();
    expect(screen.queryByText("Outstanding follow-up")).not.toBeInTheDocument();
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

  it("offers to add one, anchored to the visit just saved", async () => {
    const user = await saveVisit();
    expect(await screen.findByRole("status")).toHaveTextContent("Saved #06-201.");
    await user.click(screen.getByRole("button", { name: "Add follow-up" }));

    const sheet = screen.getByRole("dialog", { name: "Follow-up for #06-201" });
    await user.type(within(sheet).getByLabelText("Note"), "Call on Sunday");
    await user.click(within(sheet).getByRole("button", { name: "Save follow-up" }));

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
    expect(screen.getByRole("status")).toHaveTextContent("Saved #06-201. Follow-up added.");
    expect(screen.queryByRole("button", { name: "Add follow-up" })).not.toBeInTheDocument();
  });

  it("can be dismissed without adding anything", async () => {
    const user = await saveVisit();
    await user.click(await screen.findByRole("button", { name: "Add follow-up" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add follow-up" })).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Add follow-up" })).not.toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: "Add follow-up" }));
    const sheet = screen.getByRole("dialog", { name: "Follow-up for #06-201" });
    await user.type(within(sheet).getByLabelText("Note"), "Call on Sunday");
    await user.click(within(sheet).getByRole("button", { name: "Save follow-up" }));
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
