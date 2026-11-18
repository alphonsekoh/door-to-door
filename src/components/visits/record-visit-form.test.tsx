import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type Root, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type * as ApiClientModule from "@/lib/api-client";
import { ApiRequestError } from "@/lib/api-client";
import {
  OFF_THE_LIST,
  RecordVisitForm,
  blockedMessage,
  validateVisit,
} from "@/components/visits/record-visit-form";
import type { ActiveSession, FollowUp, HouseholdSummary } from "@/generated/types.gen";
import { UNIT_TOO_LONG } from "@/lib/not-saved";
import { shellState } from "@/lib/offline/shell-state";
import { type VisitDraft, buildQueuedVisit } from "@/lib/sync/enqueue";
import { OUTING_ASK_TIMEOUT_MS, type OutingAnswer } from "@/lib/sync/outing";
import type { QueuedVisit } from "@/lib/sync/types";
import { landWhileTyping } from "../../../test/land-while-typing";

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
/* One past the contract's 32 characters, and the longest it takes. */
const TOO_LONG = "#".padEnd(33, "1");
const LONGEST = "#".padEnd(32, "1");
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
  answered: true,
  pagination: { limit: 20, offset: 0, total: 1, hasMore: false },
  followUps: [],
  ...over,
});

type Late = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };

const notSaved = () => within(screen.getByRole("alertdialog", { name: "Not saved" }));

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
  waitingSuggestionBy: null,
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
  picks: [{ householdId: "h1", addedAt: "2024-12-31T00:00:00.000Z" }],
};

describe("validateVisit", () => {
  it("requires a unit number", () => {
    expect(validateVisit("  ", "low").unitNumber).toBe("Enter the unit number.");
  });

  it("refuses a unit past the contract's 32 characters, not counting spaces around it", () => {
    expect(validateVisit(TOO_LONG, "low").unitNumber).toBe(
      "The unit number is too long (32 characters at most).",
    );
    expect(validateVisit(`  ${LONGEST}  `, "low")).toEqual({});
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

  it("says a unit is too long rather than ask for one", () => {
    expect(blockedMessage(validateVisit(TOO_LONG, "low"))).toBe(
      "Not saved. The unit number is too long (32 characters at most).",
    );
    expect(blockedMessage(validateVisit(TOO_LONG, null))).toBe(
      "Not saved. The unit number is too long (32 characters at most). Choose an interest level.",
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

  it("offers interest levels as four targets, not a dropdown", () => {
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

/*
 * On a slow connection the server's HTML is on screen well before its
 * script, and a member types the unit and picks a level into it (#113).
 */
describe("before the page is live", () => {
  const form = (
    <RecordVisitForm
      sessionId={null}
      loadSession={noSession}
      blockId={BLOCK}
      known={[]}
      initialUnit="#05-123"
      onRecorded={vi.fn()}
    />
  );

  /* The server's HTML, typed into and tapped with no script running. */
  function typedBeforeLive(unit: string): HTMLElement {
    const container = document.createElement("div");
    container.innerHTML = renderToString(form);
    document.body.append(container);
    onTestFinished(() => {
      container.remove();
    });
    const field = within(container).getByLabelText("Unit number");
    if (!(field instanceof HTMLInputElement)) throw new Error("the unit field is not an input");
    field.value = unit;
    within(container).getByRole("radio", { name: "High" }).click();
    return container;
  }

  /* Unmounted however the test ends, as cleanup() only knows render()'s roots. */
  function unmountAfter(root: Root): void {
    onTestFinished(() => {
      act(() => {
        root.unmount();
      });
    });
  }

  it("keeps the unit typed and the level picked, and Save then saves them", async () => {
    const user = userEvent.setup();
    const container = typedBeforeLive("#09-999");
    const mismatch = vi.fn();
    unmountAfter(await act(() => hydrateRoot(container, form, { onRecoverableError: mismatch })));

    expect(mismatch).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Unit number")).toHaveValue("#09-999");
    expect(screen.getByRole("radio", { name: "High" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });
    expect(body()).toMatchObject({ unitNumber: "#09-999", interestLevel: "high" });
    expect(screen.queryByRole("alertdialog", { name: "Not saved" })).toBeNull();
  });

  /* React hydrates at once for a tap that reaches it first, then hands the
     tap on: the Save must see the unit, not report it missing. */
  it("saves the unit typed before a Save tapped as the page goes live", async () => {
    const container = typedBeforeLive("#09-999");
    const inAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT") as unknown;
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
    onTestFinished(() => {
      Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", inAct);
    });
    unmountAfter(hydrateRoot(container, form));
    within(container).getByRole("button", { name: "Save and next" }).click();

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });
    expect(body()).toMatchObject({ unitNumber: "#09-999", interestLevel: "high" });
    expect(within(container).queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("alertdialog", { name: "Not saved" })).toBeNull();
  });

  /* Enter submits a form by its first submit button, and does nothing when
     that is disabled; with no script, that submit would reload the page. */
  it("gives Enter nothing to submit until the page is live, then Save", async () => {
    const container = typedBeforeLive("#09-999");
    const first = () => container.querySelector("form")?.querySelector('button[type="submit"]');
    expect(first()).toBeDisabled();
    expect(first()).not.toBeVisible();

    unmountAfter(await act(() => hydrateRoot(container, form)));
    expect(first()).toHaveAccessibleName("Save and next");
    expect(first()).toBeEnabled();
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

  it("promises and guesses no next unit while the kind of session is not known", async () => {
    apiFetch.mockResolvedValue({ id: "v1", householdId: "h1" });
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        guessNext={false}
        onRecorded={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Saved #05-123.");
    expect(screen.getByLabelText("Unit number")).toHaveValue("");
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
      expect(screen.getByRole("radio", { name: "High" })).not.toBeChecked();
    });
  });

  it("brings the Saved line back into view after each save, and only then", async () => {
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
    /* The line itself, which the unit field follows: anything also holding
       the block's chips can be taller than the screen, and is then aligned
       by its bottom. */
    expect(scrolled.mock.contexts[0]).toBe(screen.getByRole("status"));
    expect(screen.getByRole("status")).toHaveClass("scroll-clear-chrome");

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

  /* It lands once the unit's history is read. Above the interest level it
     pushed the picker down under a thumb on its way to it (#196). */
  it("shows it after the interest level and the details, so its landing moves nothing tapped", async () => {
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
    await user.click(screen.getByRole("button", { name: "Add details" }));
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    const panel = await screen.findByRole("region", { name: "What we know about this unit" });
    for (const tapped of [
      screen.getByRole("radio", { name: "Medium" }),
      screen.getByRole("button", { name: "Hide details" }),
      screen.getByLabelText("Notes"),
    ]) {
      expect(tapped.compareDocumentPosition(panel)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
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

  it("lets an admin mark a note done at the door in a door-to-door session, then re-reads the unit", async () => {
    // Saving marks it done only in a follow-up session; elsewhere the button stays.
    useRole.mockReturnValue({ userId: "a1", isAdmin: true });
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
    expect(screen.queryByRole("list", { name: "On the follow-up list" })).not.toBeInTheDocument();
    expect(
      apiFetch.mock.calls.filter(([path]) => path === "/households/h1?limit=20&offset=0"),
    ).toHaveLength(2);
  });

  it("keeps a resolved note to one line with no controls at the door", async () => {
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
    useRole.mockReturnValue({ userId: "a1", isAdmin: true });
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

  /* Marked done, then on to the next unit while that is on its way: its
     answer must not put this unit back as it lands (#155). */
  it("keeps the next unit typed as Mark done's answer lands", async () => {
    useRole.mockReturnValue({ userId: "a1", isAdmin: true });
    let finish: (value: unknown) => void = () => undefined;
    apiFetch.mockImplementation((_path: string, init?: { method?: string }) =>
      init?.method === "PATCH"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(history({ followUps: [owed] })),
    );
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[summary("#05-123")]}
        initialUnit="#05-123"
        onRecorded={vi.fn()}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Mark done" }));
    const field = screen.getByLabelText<HTMLInputElement>("Unit number");

    await landWhileTyping(field, "#05-124", () => {
      finish({});
    });

    expect(field).toHaveValue("#05-124");
    await waitFor(() => {
      expect(screen.queryByText("Mr Tan")).not.toBeInTheDocument();
    });
    expect(field).toHaveValue("#05-124");
  });

  it("offers no Mark done in a follow-up session, where saving the visit marks it done", async () => {
    apiFetch.mockResolvedValue(history({ followUps: [owed] }));
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

    expect(await screen.findByText("Saving your visit marks this done.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
  });

  it("says so once for every note the save marks done", async () => {
    // An admin too: the save marks them whoever records it.
    useRole.mockReturnValue({ userId: "a1", isAdmin: true });
    apiFetch.mockResolvedValue(history({ followUps: [owed, { ...owed, id: "f2" }] }));
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

    expect(await screen.findByText("Saving your visit marks these done.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
    // Edit and Remove stay: only marking done moves to the save.
    expect(screen.getAllByRole("button", { name: "Remove from list" })).toHaveLength(2);
  });

  it("keeps an admin's Mark done at a household the follow-up session did not pick", async () => {
    useRole.mockReturnValue({ userId: "a1", isAdmin: true });
    apiFetch.mockResolvedValue(history({ followUps: [owed] }));
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[summary("#05-123")]}
        active={{ ...FOLLOW_UP, picks: [] }}
        onRecorded={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), "#05-123");

    expect(await screen.findByRole("button", { name: "Mark done" })).toBeInTheDocument();
    expect(screen.queryByText(/Saving your visit marks/)).toBeNull();
  });

  it("drops the last unit's history when a different unit's lookup fails", async () => {
    apiFetch.mockImplementation((path: string) =>
      path === "/households/h1?limit=20&offset=0"
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
        path === "/households/h1?limit=20&offset=0"
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
        expect(apiFetch).toHaveBeenCalledWith("/households/h1?limit=20&offset=0");
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

  /* As the block screen's answers can (#155): WebKit can run the history's
     answer inside the event of text landing in the field, after the field
     has changed and before React has read it. */
  it("keeps what is typed as the unit's history lands", async () => {
    let answer: (value: unknown) => void = () => undefined;
    apiFetch.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[summary("#05-123")]}
        initialUnit="#05-123"
        onRecorded={vi.fn()}
      />,
    );
    const field = screen.getByLabelText<HTMLInputElement>("Unit number");
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith("/households/h1?limit=20&offset=0");
    });

    await landWhileTyping(field, "#05-1234", () => {
      answer(history());
    });

    expect(field).toHaveValue("#05-1234");
    await waitFor(() => {
      expect(screen.queryByText("Mr Tan")).not.toBeInTheDocument();
    });
    expect(field).toHaveValue("#05-1234");
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

/*
 * The history is last in the form, so its landing moves nothing tapped, and
 * on an iPhone at the default text that put all of it below Save: an overdue
 * note went unseen before the knock (#196). One line under the unit field
 * says what it holds, and leads down to it.
 */
describe("the line under the unit field", () => {
  const line = () => document.getElementById("unit-history");
  /* What is in it, once it is there. */
  const inLine = () => {
    const found = line();
    if (found === null) throw new Error("No line under the unit field");
    return within(found);
  };
  const visits = (total: number) => ({ limit: 20, offset: 0, total, hasMore: false });
  const DUE_LONG_AGO = "2020-01-01T00:00:00.000Z";
  const DUE_LATER = "2999-01-01T00:00:00.000Z";

  const mount = (props: { initialUnit?: string } = {}) =>
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[summary("#05-123")]}
        onRecorded={vi.fn()}
        {...props}
      />,
    );

  const typeUnit = async (unit: string) => {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Unit number"), unit);
    return user;
  };

  it("says a note owed on the follow-up list is overdue, the visits, and leads to the history", async () => {
    apiFetch.mockResolvedValue(history({ followUps: [{ ...owed, dueDate: DUE_LONG_AGO }] }));
    mount();
    await typeUnit("#05-123");

    await waitFor(() => {
      expect(line()).toHaveTextContent(/^On the follow-up list · Overdue · 1 visit · See history$/);
    });
    const said = inLine();
    // Words as well as colour, in the tone the history gives an overdue note,
    // and in the line's own weight, the one its held copy is set in.
    expect(said.getByText("Overdue")).toHaveClass("text-danger");
    expect(said.getByText("Overdue").className).not.toMatch(/\bfont-/);
    expect(said.getByText("follow-up")).toHaveClass("whole-word");
    expect(said.getByRole("button", { name: "See history" })).toBeInTheDocument();
  });

  it("says nothing is overdue of a note owed later, or on no day", async () => {
    apiFetch.mockResolvedValue(
      history({
        followUps: [
          { ...owed, dueDate: DUE_LATER },
          { ...owed, id: "f2" },
        ],
        pagination: visits(3),
      }),
    );
    mount();
    await typeUnit("#05-123");

    await waitFor(() => {
      expect(line()).toHaveTextContent(/^On the follow-up list · 3 visits · See history$/);
    });
  });

  it("says a suggestion waits for review where nothing is owed", async () => {
    const waiting = { ...owed, status: "suggested" as const, dueDate: DUE_LONG_AGO };
    apiFetch.mockResolvedValue(history({ followUps: [waiting] }));
    mount();
    await typeUnit("#05-123");

    await waitFor(() => {
      expect(line()).toHaveTextContent(/^Waiting for review · 1 visit · See history$/);
    });
  });

  it("gives only the visits of a unit with nothing on the list or waiting", async () => {
    const done = { ...owed, dueDate: DUE_LONG_AGO, doneAt: "2026-01-02T00:00:00.000Z" };
    apiFetch.mockResolvedValue(history({ followUps: [done], pagination: visits(12) }));
    mount();
    await typeUnit("#05-123");

    await waitFor(() => {
      expect(line()).toHaveTextContent(/^12 visits · See history$/);
    });
  });

  /* Only a unit with a history to read has the line (owner, 2026-11-18): a
     row kept at every new door put the interest level under the docked Save
     after Save and next on an iPhone at its default text. */
  it("has no line, and keeps no room, for a unit the block's units read have no household at", async () => {
    mount();
    await typeUnit("#09-999");
    expect(line()).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("has no line for a unit whose only visit waits on this phone", async () => {
    const waiting = buildQueuedVisit(
      {
        blockId: BLOCK,
        unitNumber: "#09-999",
        interestLevel: "high",
        description: "",
        name: "",
        contact: "",
        religion: "",
        sessionId: "s1",
      },
      "u1",
      Date.parse("2026-10-15T10:00:00.000Z"),
      () => "v-queued",
    );
    useSyncQueue.mockReturnValue({ ...NO_QUEUE, records: [waiting] });
    mount();
    await typeUnit("09-999");
    expect(line()).toBeNull();
  });

  it("says it is reading a known unit's history until it lands", async () => {
    let answer: (value: unknown) => void = () => undefined;
    apiFetch.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    mount();
    await typeUnit("#05-123");
    expect(line()).toHaveTextContent(/^Checking this unit's history…$/);

    await act(async () => {
      answer(history());
      await Promise.resolve();
    });
    expect(line()).toHaveTextContent(/^1 visit · See history$/);
  });

  it("says when the history could not be read, and Save still saves", async () => {
    apiFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    mount();
    const user = await typeUnit("#05-123");

    await waitFor(() => {
      expect(line()).toHaveTextContent(/^Could not read this unit's history\.$/);
    });
    expect(screen.queryByRole("region", { name: "What we know about this unit" })).toBeNull();

    apiFetch.mockResolvedValueOnce({ id: "v1", householdId: "h1" });
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved #05-123.");
  });

  it("reads a unit typed again afresh, saying it is reading rather than that it could not", async () => {
    let answer: (value: unknown) => void = () => undefined;
    const reads = [
      () => Promise.reject(new TypeError("Failed to fetch")),
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    ];
    apiFetch.mockImplementation((path: string) =>
      path === "/households/h1?limit=20&offset=0"
        ? reads.shift()?.()
        : Promise.resolve(history({ household: summary("#05-125", "h2").household })),
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
      expect(line()).toHaveTextContent(/^Could not read this unit's history\.$/);
    });

    // Straight to another known unit and back, never through an unknown one.
    fireEvent.change(unit, { target: { value: "#05-125" } });
    fireEvent.change(unit, { target: { value: "#05-123" } });
    expect(line()).toHaveTextContent(/^Checking this unit's history…$/);
    await act(async () => {
      answer(history());
      await Promise.resolve();
    });
    expect(line()).toHaveTextContent(/^1 visit · See history$/);
  });

  /* Its height is held from the keystroke the unit matches, so neither the
     history landing nor any of what the line comes to say moves what is
     below. */
  it("is held at the longest it can say from the keystroke the unit matches, and goes once it does not", async () => {
    apiFetch.mockResolvedValue(history());
    mount();
    const unit = screen.getByLabelText("Unit number");
    fireEvent.change(unit, { target: { value: "#05-12" } });
    expect(line()).toBeNull();
    fireEvent.change(unit, { target: { value: "#05-123" } });

    const held = line();
    expect(held).toHaveTextContent(/^Checking this unit's history…$/);
    expect(held).toHaveClass("hold-text", "leading-target");
    // Every two-figure count as wide as the held one.
    expect(held).toHaveClass("tabular-nums");
    // Held from CSS, so in no text a reader or a test reads, with its hyphen
    // as unbreakable as WholeWords holds it on screen.
    expect(held).toHaveAttribute(
      "data-hold",
      "On the follow‑up list · Overdue · 99 visits · See history",
    );
    // Heard when it changes, as one line.
    expect(held).toHaveAttribute("aria-live", "polite");
    expect(held).toHaveAttribute("aria-atomic", "true");

    await waitFor(() => {
      expect(line()).toHaveTextContent("See history");
    });
    expect(line()).toBe(held);

    // Typing on, to a unit the block has no household at, takes it away.
    fireEvent.change(unit, { target: { value: "#05-1234" } });
    expect(line()).toBeNull();
    fireEvent.change(unit, { target: { value: "" } });
    expect(line()).toBeNull();
  });

  /* After Save and next the next unit is the app's guess: a known one has
     its line from that same render, a new one none. */
  it("comes with a known next unit after Save and next, and not with a new one", async () => {
    let answer: (value: unknown) => void = () => undefined;
    apiFetch.mockImplementation((path: string) =>
      path === "/visits"
        ? Promise.resolve({ id: "v1", householdId: "h0" })
        : new Promise((resolve) => {
            answer = resolve;
          }),
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
    const unit = screen.getByLabelText("Unit number");
    await user.type(unit, "#05-122");
    expect(line()).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    await waitFor(() => {
      expect(unit).toHaveValue("#05-123");
    });
    expect(line()).toHaveTextContent(/^Checking this unit's history…$/);
    expect(line()).toHaveAttribute("data-hold", expect.stringContaining("99 visits"));
    await act(async () => {
      answer(history());
      await Promise.resolve();
    });
    expect(line()).toHaveTextContent(/^1 visit · See history$/);

    await user.click(screen.getByRole("radio", { name: "Low" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));
    await waitFor(() => {
      expect(unit).toHaveValue("#05-124");
    });
    expect(line()).toBeNull();
  });

  it("is under the unit field and what it says of it, above the session's notice and chips", async () => {
    apiFetch.mockReturnValue(new Promise(() => undefined));
    render(
      <RecordVisitForm
        sessionId={null}
        loadSession={noSession}
        blockId={BLOCK}
        known={[summary("#05-124", "h2")]}
        followUp={{
          revisits: [
            {
              household: { ...summary("#05-123").household },
              block: {
                id: BLOCK,
                name: "123",
                street: "Test Ave",
                postalCode: null,
                createdAt: "",
              },
              notes: [owed],
              latestVisit: null,
              visitedInSession: false,
            },
          ],
        }}
        onRecorded={vi.fn()}
      />,
    );
    await typeUnit("#05-124");
    const gate = document.getElementById("unit-gate");
    const notice = screen.getByText(/Only units on the list can be recorded\.$/);
    const chips = screen.getByRole("list", { name: "On the list in this block" });
    expect(gate?.compareDocumentPosition(line() as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(line()?.compareDocumentPosition(notice)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(line()?.compareDocumentPosition(chips)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("takes See history down to the history, clear of the pinned chrome, and focus into it", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    try {
      apiFetch.mockResolvedValue(history());
      mount();
      const user = await typeUnit("#05-123");
      const panel = await screen.findByRole("region", { name: "What we know about this unit" });
      expect(scrolled).not.toHaveBeenCalled();

      await user.click(inLine().getByRole("button", { name: "See history" }));
      expect(scrolled).toHaveBeenCalledOnce();
      expect(scrolled).toHaveBeenCalledWith({ block: "start" });
      expect(scrolled.mock.contexts[0]).toBe(panel);
      // Its top clear of the pinned sync row; jsdom lays nothing out, the E2E measures.
      expect(panel).toHaveClass("scroll-clear-chrome");
      // Its first line, so a screen reader reads on from there.
      const first = within(panel).getByText("Mr Tan");
      expect(first).toHaveAttribute("tabindex", "-1");
      expect(first).toHaveFocus();
      /* Not the panel: in WebKit a tap on anything in it that is not itself
         focusable, its buttons too, focused it and scrolled the page. */
      expect(panel).not.toHaveAttribute("tabindex");
    } finally {
      scrolled.mockRestore();
    }
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
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Saved #06-201.");
    // Its words are held only where the offer has a row of its own: beside
    // them, the held words would widen them and push it there (#196).
    expect(status.firstElementChild).toHaveClass("hold-text-narrow");
    expect(status.firstElementChild).not.toHaveClass("hold-text");
    const suggest = within(status).getByRole("button", { name: "Suggest a return visit" });
    expect(suggest.parentElement).toHaveClass("offer-row");
    await user.click(suggest);

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
    expect(status).toHaveTextContent("Saved #06-201. Suggestion sent. An admin will review it.");
    expect(
      screen.queryByRole("button", { name: "Suggest a return visit" }),
    ).not.toBeInTheDocument();
    // Nothing more is offered, so no row is kept for it.
    expect(status.querySelector(".offer-row")).toBeNull();
    expect(status.firstElementChild).toHaveClass("hold-text");
  });

  it("offers an admin the follow-up list itself", async () => {
    useRole.mockReturnValue({ userId: "a1", isAdmin: true });
    const user = await saveVisit();
    const add = await screen.findByRole("button", { name: "Add to follow-up list" });
    // "Follow-" over "up" read as two words at large text (#196).
    expect(within(add).getByText("follow-up")).toHaveClass("whole-word");
    await user.click(add);
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
    // The suggestion is shown before it is listed, in its author's words.
    const sheet = within(
      screen.getByRole("dialog", { name: "Add to the follow-up list, #05-123" }),
    );
    const add = sheet.getByRole("button", { name: "Add to list" });
    await waitFor(() => {
      expect(add).toBeEnabled();
    });
    await user.click(add);
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
    await user.click(notSaved().getByRole("button", { name: "OK" }));

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
    // A choice not made is not blank text: the line alone says so (#119).
    expect(screen.queryByRole("alertdialog")).toBeNull();
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
    await user.click(notSaved().getByRole("button", { name: "OK" }));
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
    await user.click(notSaved().getByRole("button", { name: "OK" }));
    expect(screen.getByLabelText("Unit number")).toHaveAttribute("aria-invalid", "true");
  });

  it("reports a failure without losing what was typed", async () => {
    // Retyping a description at the door is exactly what loses records.
    apiFetch.mockRejectedValue(
      new ApiRequestError(409, {
        error: { code: "session_not_active", message: "No session is active." },
      }),
    );
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

describe("the Not saved pop-up (#119)", () => {
  const renderForm = () => {
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
    return user;
  };
  const save = () => screen.getByRole("button", { name: "Save and next" });

  it("refuses a unit past the contract's 32 characters and says why, cutting nothing", async () => {
    const user = renderForm();
    const unit = screen.getByLabelText("Unit number");
    await user.type(unit, TOO_LONG);
    expect(unit).toHaveValue(TOO_LONG);
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(save());

    expect(
      notSaved()
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["The unit number is too long (32 characters at most)."]);
    await user.click(notSaved().getByRole("button", { name: "OK" }));

    expect(unit).toHaveFocus();
    expect(unit).toHaveValue(TOO_LONG);
    expect(unit).toHaveAttribute("aria-invalid", "true");
    expect(unit).toHaveAccessibleDescription(UNIT_TOO_LONG);
    expect(screen.getByRole("alert")).toHaveTextContent(`Not saved. ${UNIT_TOO_LONG}`);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("sends a unit of exactly 32 characters", async () => {
    const user = renderForm();
    await user.type(screen.getByLabelText("Unit number"), LONGEST);
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(save());

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalled();
    });
    expect(body()).toMatchObject({ unitNumber: LONGEST });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("says what is wrong with the unit as it is fixed, until it is", async () => {
    const user = renderForm();
    await user.click(save());
    await user.click(notSaved().getByRole("button", { name: "OK" }));
    const unit = screen.getByLabelText("Unit number");
    expect(unit).toHaveAccessibleDescription("Enter the unit number.");

    await user.click(unit);
    await user.paste(TOO_LONG);
    expect(unit).toHaveAccessibleDescription(UNIT_TOO_LONG);
    // Typing on is not fixing it: the red stays.
    await user.type(unit, "1");
    expect(unit).toHaveAccessibleDescription(UNIT_TOO_LONG);
    await user.type(unit, "{Backspace}{Backspace}");
    expect(unit).toHaveValue(LONGEST);
    expect(unit).toHaveAttribute("aria-invalid", "false");
  });

  it("lists every reason refused at once, and OK goes back to the unit", async () => {
    const user = renderForm();
    await user.type(screen.getByLabelText("Unit number"), "   ");
    await user.click(save());

    expect(notSaved().getByText("This visit could not be saved because:")).toBeInTheDocument();
    expect(
      notSaved()
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["The unit number is blank.", "No interest level is chosen."]);
    expect(notSaved().getByRole("button", { name: "OK" })).toHaveFocus();

    await user.click(notSaved().getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByLabelText("Unit number")).toHaveFocus();
    // What was said before is still said, for anyone who missed the pop-up.
    expect(screen.getByLabelText("Unit number")).toHaveAccessibleDescription(
      "Enter the unit number.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Not saved. Enter the unit number and choose an interest level.",
    );
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("names the unit alone when the interest level was chosen", async () => {
    const user = renderForm();
    await user.click(screen.getByRole("radio", { name: "Medium" }));
    await user.click(save());

    expect(
      notSaved()
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["The unit number is blank."]);
  });

  it("is dismissed by Escape too, with focus on the unit", async () => {
    const user = renderForm();
    await user.click(save());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByLabelText("Unit number")).toHaveFocus();
  });

  it("opens for the server's refusal too, pointing at the field it named", async () => {
    // The server's issue does not say which of its rules the unit broke.
    apiFetch.mockRejectedValue(
      new ApiRequestError(400, {
        error: {
          code: "validation_failed",
          message: "Invalid request body.",
          details: [
            { path: "/unitNumber", message: "Too big: expected string to have <=32 characters" },
          ],
        },
      }),
    );
    const user = renderForm();
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(save());

    expect(await screen.findByRole("alertdialog", { name: "Not saved" })).toBeInTheDocument();
    expect(
      notSaved()
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["The unit number is blank or too long."]);
    await user.click(notSaved().getByRole("button", { name: "OK" }));

    const unit = screen.getByLabelText("Unit number");
    expect(unit).toHaveFocus();
    expect(unit).toHaveValue("#05-123");
    expect(unit).toHaveAttribute("aria-invalid", "true");
    expect(unit).toHaveAccessibleDescription("The unit number is blank or too long.");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Not saved. The unit number is blank or too long.",
    );
  });

  it("keeps the server's words for a field it has no place for, and gives focus back to Save", async () => {
    apiFetch.mockRejectedValue(
      new ApiRequestError(400, {
        error: {
          code: "validation_failed",
          message: "Invalid request body.",
          details: [{ path: "/description", message: "Too big" }],
        },
      }),
    );
    const user = renderForm();
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(save());

    expect(await screen.findByRole("alertdialog", { name: "Not saved" })).toBeInTheDocument();
    expect(
      notSaved()
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Too big"]);
    await user.click(notSaved().getByRole("button", { name: "OK" }));
    expect(save()).toHaveFocus();
    expect(screen.getByLabelText("Unit number")).toHaveAttribute("aria-invalid", "false");
  });

  it("sends focus to the first interest level when that is what the server named", async () => {
    apiFetch.mockRejectedValue(
      new ApiRequestError(400, {
        error: {
          code: "validation_failed",
          message: "Invalid request body.",
          details: [{ path: "/interestLevel", message: "Invalid option" }],
        },
      }),
    );
    const user = renderForm();
    await user.type(screen.getByLabelText("Unit number"), "#05-123");
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(save());

    // One was chosen, so the refusal does not say none was.
    expect(
      within(await screen.findByRole("alertdialog", { name: "Not saved" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["The interest level was not accepted."]);
    expect(screen.getByRole("radiogroup", { name: "Interest level" })).toHaveAccessibleDescription(
      "The interest level was not accepted.",
    );
    await user.click(notSaved().getByRole("button", { name: "OK" }));
    expect(screen.getByRole("radio", { name: "No response" })).toHaveFocus();
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

  /* At large text "Saved … on this phone." wrapped a row taller than
     "Sending…", and the unit field dropped 48px just after Save. */
  it("keeps room from Sending on for the words it says once on the phone", async () => {
    const queue = withQueue();
    const { view } = await fill();
    const status = await screen.findByRole("status");
    const words = status.firstElementChild;
    // Held from CSS, so in no text a reader or a test reads, with the unit's
    // hyphen as unbreakable as it is on screen. A member is offered a
    // suggestion once it is sent, so only where that has a row of its own.
    expect(words).toHaveClass("hold-text-narrow");
    expect(words?.getAttribute("data-hold")?.replaceAll("\u2011", "-")).toBe(status.textContent);
    expect(status).toHaveTextContent(/^Saved #06-201 on this phone\.$/);

    queue.inFlight = new Set(["v-queued"]);
    rerenderForm(view);
    expect(status).toHaveTextContent(/^Sending #06-201…$/);
    expect(words).toHaveAttribute("data-hold", "Saved #06\u2011201 on this phone.");
  });

  it("keeps an admin's offer of the list its room, the hyphen held as on screen", async () => {
    useRole.mockReturnValue({ userId: "a1", isAdmin: true });
    withQueue();
    await fill();
    const status = await screen.findByRole("status");
    expect(status.querySelector(".offer-row > .offer-pending")).toHaveAttribute(
      "data-hold",
      "Add to follow\u2011up list",
    );
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
    const status = await screen.findByRole("status");
    /* The offer's row is there from the save on, as tall as the offer's
       words, with nothing to tap until the server has the visit: turning up
       with the send, it dropped the unit field a row at large text (#196). */
    const row = status.querySelector(".offer-row");
    expect(row?.children).toHaveLength(1);
    expect(row?.firstElementChild).toHaveClass("offer-pending");
    expect(row?.firstElementChild).toHaveAttribute("data-hold", "Suggest a return visit");
    expect(row?.textContent).toBe("");
    expect(within(status).queryByRole("button")).toBeNull();

    queue.records = [
      {
        ...stored(draftFor("#06-201")),
        state: "synced",
        serverVisit: { ...visitRow, id: "v-queued", householdId: "h-server" },
      },
    ];
    rerenderForm(view);
    expect(status).toHaveTextContent("Saved #06-201.");

    const suggest = within(status).getByRole("button", { name: "Suggest a return visit" });
    // In the row kept for it, which holds nothing else now.
    expect(suggest.parentElement).toBe(row);
    expect(row?.children).toHaveLength(1);
    expect(status.firstElementChild).toHaveAttribute(
      "data-hold",
      "Saved #06\u2011201 on this phone.",
    );
    await user.click(suggest);
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

  it("never queues a unit the server would refuse as too long", async () => {
    const queue = withQueue();
    const user = userEvent.setup();
    render(
      <RecordVisitForm
        sessionId={SESSION}
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        onRecorded={onRecorded}
      />,
    );
    await user.type(screen.getByLabelText("Unit number"), TOO_LONG);
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save and next" }));

    expect(notSaved().getByRole("listitem")).toHaveTextContent(UNIT_TOO_LONG);
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Unit number")).toHaveValue(TOO_LONG);
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
    apiFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await fill();

    const alert = await screen.findByRole("alert");
    // The form's sentence, never the browser's (#194).
    expect(alert).toHaveTextContent("Could not save this visit.");
    expect(alert).not.toHaveTextContent("Failed to fetch");
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

  /* It comes with the session's answer. Above the form it dropped the unit
     field 170px at large text, under a tap (#200). */
  it("says what the session allows under the unit field, above the chips it explains", () => {
    mount();
    const notice = screen.getByText(/Only units on the list can be recorded\.$/);
    expect(notice).toHaveTextContent(
      /^Follow-up session · Only units on the list can be recorded\.$/,
    );
    expect(within(notice).getByText("Follow-up")).toHaveClass("whole-word");
    const field = screen.getByLabelText("Unit number");
    const chips = screen.getByRole("list", { name: "On the list in this block" });
    expect(field.compareDocumentPosition(notice)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(notice.compareDocumentPosition(chips)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("tells an admin they can record any unit", () => {
    useRole.mockReturnValue({ userId: "a1", isAdmin: true });
    mount();
    expect(screen.getByText(/Only units on the list can be recorded\./)).toHaveTextContent(
      /\. As an admin you can record any unit\.$/,
    );
  });

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
      "#05-124 is not on this session's list, so it can't be recorded in this session. Ask an admin to add it.",
    );
    await user.click(screen.getByRole("radio", { name: "High" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Not saved. This unit is not on this session's list.",
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
    const suggest = await screen.findByRole("button", { name: "Suggest a return visit" });
    // One way to get it listed is offered, not "ask an admin" beside it.
    expect(screen.getByLabelText("Unit number")).toHaveAccessibleDescription(
      "#05-124 is not on this session's list, so it can't be recorded in this session. Should it be? Suggest it for an admin to review. Suggest a return visit",
    );
    await user.click(suggest);
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
    expect(screen.getByLabelText("Unit number")).toHaveAccessibleDescription(
      /A suggestion to add it is waiting for an admin to review\.$/,
    );
  });

  it("says a household on the follow-up list needs adding to this session", async () => {
    // Listed, but this session did not pick it: only an admin can add it.
    apiFetch.mockResolvedValue(
      history({ household: summary("#05-124", "h9").household, followUps: [owed] }),
    );
    const user = userEvent.setup();
    mount(LIST, [summary("#05-124", "h9")]);
    await user.type(screen.getByLabelText("Unit number"), "#05-124");
    expect(await screen.findByRole("list", { name: "On the follow-up list" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suggest a return visit" })).toBeNull();
    expect(screen.getByLabelText("Unit number")).toHaveAccessibleDescription(
      "#05-124 is not on this session's list, so it can't be recorded in this session. It is on the follow-up list; ask an admin to add it to this session.",
    );
  });

  it("says nothing of what to do while a known unit's history loads", async () => {
    apiFetch.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    mount(LIST, [summary("#05-124", "h9")]);
    await user.type(screen.getByLabelText("Unit number"), "#05-124");
    expect(screen.getByLabelText("Unit number")).toHaveAccessibleDescription(
      "#05-124 is not on this session's list, so it can't be recorded in this session.",
    );
  });

  it("never suggests the unit typed before, while the next one's history loads", async () => {
    let later: (value: unknown) => void = () => undefined;
    apiFetch
      .mockResolvedValueOnce(history({ household: summary("#05-124", "h9").household }))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          later = resolve;
        }),
      );
    const user = userEvent.setup();
    mount(LIST, [summary("#05-124", "h9"), summary("#05-125", "h10")]);
    const unit = screen.getByLabelText("Unit number");
    await user.type(unit, "#05-124");
    expect(await screen.findByRole("button", { name: "Suggest a return visit" })).toBeVisible();

    // Straight from one known unit to the next, as a chip or a paste does.
    fireEvent.change(unit, { target: { value: "#05-125" } });
    expect(screen.queryByRole("button", { name: "Suggest a return visit" })).toBeNull();
    act(() => {
      later(history({ household: summary("#05-125", "h10").household }));
    });
    expect(await screen.findByRole("button", { name: "Suggest a return visit" })).toBeVisible();
  });

  it("tells an admin the unit is off the list, and records it anyway", async () => {
    useRole.mockReturnValue({ userId: "a1", isAdmin: true });
    apiFetch.mockResolvedValue({ id: "v1", householdId: "h1" });
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Unit number"), "#05-124");
    expect(screen.getByLabelText("Unit number")).toHaveAccessibleDescription(
      "Not on this session's list. You can still record it as an admin.",
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
      "Could not check this session's list. A visit to a unit not on it will wait on this phone until an admin adds it.",
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
      "Not saved. This unit is not on this session's list.",
    );
  });

  describe("marking the follow-up done on save", () => {
    const UNDO = "Undo marking the follow-up done";
    const REASON =
      "Ann's suggestion for this door is waiting for an admin. Ask an admin to review it.";
    const recheck = vi.fn(() => Promise.resolve(LIST));
    const onRecorded = vi.fn();

    /* The follow-up row once it says exactly `words`: each hyphenated word
       in it is an element of its own, kept whole (WholeWords). */
    const rowSaying = (scope: HTMLElement, words: string) =>
      within(scope).findByText(
        (_, element) => element?.tagName === "P" && element.textContent === words,
      );

    /* The server marks what it marks; a reopen answers as `reopen` says. */
    function server(marked: string[], reopen: () => Promise<unknown> = () => Promise.resolve({})) {
      apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
        if (path === "/visits") {
          return Promise.resolve({
            id: "v1",
            householdId: "h#05-123",
            followUpsMarkedDone: marked,
          });
        }
        return init?.method === "PATCH" ? reopen() : Promise.resolve(history());
      });
    }

    const form = (revisits = LIST) => (
      <RecordVisitForm
        sessionId="s9"
        loadSession={noSession}
        blockId={BLOCK}
        known={[]}
        followUp={{ revisits, recheck }}
        onRecorded={onRecorded}
      />
    );

    const saveAt = async (unit = "#05-123", revisits = LIST) => {
      const user = userEvent.setup();
      const view = render(form(revisits));
      await user.clear(screen.getByLabelText("Unit number"));
      await user.type(screen.getByLabelText("Unit number"), unit);
      await user.click(screen.getByRole("radio", { name: "No response" }));
      await user.click(screen.getByRole("button", { name: "Save" }));
      return { user, view, status: await screen.findByRole("status") };
    };

    const patches = () =>
      apiFetch.mock.calls.filter(
        ([, init]) => (init as { method?: string } | undefined)?.method === "PATCH",
      );

    it("says it was marked done, and Undo reopens exactly that, leaving the visit", async () => {
      server(["n#05-123"]);
      const { user, status } = await saveAt();
      expect(status).toHaveTextContent("Saved #05-123.Follow-up marked done.");
      expect(onRecorded).toHaveBeenCalledTimes(1);

      await user.click(within(status).getByRole("button", { name: UNDO }));
      expect(await rowSaying(status, "Undone. Follow-up reopened.")).toBeInTheDocument();
      expect(within(status).queryByRole("button", { name: /^Undo/ })).toBeNull();
      expect(patches()).toEqual([
        [
          "/follow-ups/n#05-123",
          { method: "PATCH", body: JSON.stringify({ done: false, markedByVisit: "v1" }) },
        ],
      ]);
      // The visit itself is never touched again.
      expect(
        apiFetch.mock.calls.filter(([path]) => String(path).startsWith("/visits")),
      ).toHaveLength(1);
      // The list and the block are read again, so the row and chip read Visited.
      expect(recheck).toHaveBeenCalledTimes(1);
      expect(onRecorded).toHaveBeenCalledTimes(2);
    });

    it("says how many, and reopens them all", async () => {
      server(["a", "b"]);
      const { user, status } = await saveAt();
      expect(status).toHaveTextContent("2 follow-ups marked done.");
      await user.click(
        within(status).getByRole("button", { name: "Undo marking the follow-ups done" }),
      );
      expect(await rowSaying(status, "Undone. 2 follow-ups reopened.")).toBeInTheDocument();
      expect(patches().map(([path]) => String(path))).toEqual(["/follow-ups/a", "/follow-ups/b"]);
    });

    it("gives the server's reason when it will not reopen, and offers Undo no more", async () => {
      server(["n#05-123"], () =>
        Promise.reject(
          new ApiRequestError(409, { error: { code: "follow_up_exists", message: REASON } }),
        ),
      );
      const { user, status } = await saveAt();
      await user.click(within(status).getByRole("button", { name: UNDO }));
      expect(await within(status).findByText(`Not undone. ${REASON}`)).toBeInTheDocument();
      expect(within(status).queryByRole("button", { name: /^Undo/ })).toBeNull();
      expect(recheck).toHaveBeenCalledTimes(1);
    });

    it("keeps Undo after no answer, and a second try finishes it", async () => {
      let attempts = 0;
      server(["n#05-123"], () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new TypeError("Failed to fetch"))
          : Promise.resolve({});
      });
      const { user, status } = await saveAt();
      await user.click(within(status).getByRole("button", { name: UNDO }));
      expect(
        await within(status).findByText("Not undone. Check your signal and try again."),
      ).toBeInTheDocument();
      await user.click(within(status).getByRole("button", { name: UNDO }));
      expect(await rowSaying(status, "Undone. Follow-up reopened.")).toBeInTheDocument();
      expect(attempts).toBe(2);
    });

    it("sends one undo for two taps, and says it is working", async () => {
      let finish: (value: unknown) => void = () => undefined;
      server(["n#05-123"], () => new Promise((resolve) => (finish = resolve)));
      const { status } = await saveAt();
      const undo = within(status).getByRole("button", { name: UNDO });
      act(() => {
        fireEvent.click(undo);
        fireEvent.click(undo);
      });
      expect(within(status).getByRole("button", { name: "Undoing…" })).toBeDisabled();
      await act(async () => {
        finish({});
        await Promise.resolve();
      });
      expect(await rowSaying(status, "Undone. Follow-up reopened.")).toBeInTheDocument();
      expect(patches()).toHaveLength(1);
    });

    it("cannot undo without signal", async () => {
      server(["n#05-123"]);
      useOnline.mockReturnValue(false);
      const { status } = await saveAt();
      expect(within(status).getByRole("button", { name: UNDO })).toBeDisabled();
    });

    it("says nothing of follow-ups where the server marked none", async () => {
      // Someone marked it done by hand while the member was at the door.
      server([]);
      const { status } = await saveAt();
      expect(status).toHaveTextContent(/^Saved #05-123\.Back to the list$/);
    });

    it("says nothing for an admin's visit off the list", async () => {
      useRole.mockReturnValue({ userId: "a1", isAdmin: true });
      server([]);
      const { status } = await saveAt("#09-999");
      expect(status).not.toHaveTextContent(/marked done/);
    });

    it("lets go of Undo once another unit is typed, and drops a late answer", async () => {
      let finish: (value: unknown) => void = () => undefined;
      server(["n#05-123"], () => new Promise((resolve) => (finish = resolve)));
      const { user, status } = await saveAt();
      await user.click(within(status).getByRole("button", { name: UNDO }));
      await user.type(screen.getByLabelText("Unit number"), "#06-201");
      expect(screen.queryByRole("status")).toBeNull();
      await act(async () => {
        finish({});
        await Promise.resolve();
      });
      expect(screen.queryByText(/Undone/)).toBeNull();
    });

    /* The next unit's first keystroke can meet the answer, inside its event
       (#155): the answer must not put the emptied field back. */
    it("keeps the next unit typed as Undo's answer lands", async () => {
      let finish: (value: unknown) => void = () => undefined;
      server(["n#05-123"], () => new Promise((resolve) => (finish = resolve)));
      const { user, status } = await saveAt();
      await user.click(within(status).getByRole("button", { name: UNDO }));
      const field = screen.getByLabelText<HTMLInputElement>("Unit number");

      await landWhileTyping(field, "#06-201", () => {
        finish({});
      });

      // The answer was read while the text was landing, not after.
      expect(recheck).toHaveBeenCalledTimes(1);
      expect(field).toHaveValue("#06-201");
      // Typed over, the save's line has gone, Undo's answer with it.
      await waitFor(() => {
        expect(screen.queryByRole("status")).toBeNull();
      });
      expect(field).toHaveValue("#06-201");
    });

    it("never lets a late Undo answer speak for the next unit saved", async () => {
      const answers: ((value: unknown) => void)[] = [];
      let saves = 0;
      apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
        if (path === "/visits") {
          saves += 1;
          return Promise.resolve({
            id: `v${String(saves)}`,
            householdId: `h${String(saves)}`,
            followUpsMarkedDone: [`n${String(saves)}`],
          });
        }
        return init?.method === "PATCH"
          ? new Promise((resolve) => answers.push(resolve))
          : Promise.resolve(history());
      });
      const { user, status } = await saveAt();
      await user.click(within(status).getByRole("button", { name: UNDO }));

      // The next door is saved while the first Undo is still on its way.
      await user.type(screen.getByLabelText("Unit number"), "#06-201");
      await user.click(screen.getByRole("radio", { name: "Medium" }));
      await user.click(screen.getByRole("button", { name: "Save" }));
      const next = await screen.findByRole("status");
      expect(next).toHaveTextContent("Saved #06-201.Follow-up marked done.");

      await act(async () => {
        answers[0]?.({});
        await Promise.resolve();
      });
      // The first undo has finished: it re-read the list and the block.
      await waitFor(() => {
        expect(onRecorded).toHaveBeenCalledTimes(3);
      });
      expect(next).toHaveTextContent("Saved #06-201.Follow-up marked done.");
      expect(next).not.toHaveTextContent(/Undone/);
      expect(within(next).getByRole("button", { name: UNDO })).toBeInTheDocument();
    });

    it("never holds up the next save's Undo behind one still on its way", async () => {
      const answers: ((value: unknown) => void)[] = [];
      let saves = 0;
      apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
        if (path === "/visits") {
          saves += 1;
          return Promise.resolve({
            id: `v${String(saves)}`,
            householdId: `h${String(saves)}`,
            followUpsMarkedDone: [`n${String(saves)}`],
          });
        }
        return init?.method === "PATCH"
          ? new Promise((resolve) => answers.push(resolve))
          : Promise.resolve(history());
      });
      const { user, status } = await saveAt();
      await user.click(within(status).getByRole("button", { name: UNDO }));
      await user.type(screen.getByLabelText("Unit number"), "#06-201");
      await user.click(screen.getByRole("radio", { name: "Medium" }));
      await user.click(screen.getByRole("button", { name: "Save" }));
      const next = await screen.findByRole("status");

      await user.click(within(next).getByRole("button", { name: UNDO }));
      expect(patches().map(([path]) => String(path))).toEqual(["/follow-ups/n1", "/follow-ups/n2"]);
      expect(within(next).getByRole("button", { name: "Undoing…" })).toBeDisabled();
      await act(async () => {
        answers[0]?.({});
        await Promise.resolve();
      });
      expect(next).not.toHaveTextContent(/Undone/);
      await act(async () => {
        answers[1]?.({});
        await Promise.resolve();
      });
      expect(await rowSaying(next, "Undone. Follow-up reopened.")).toBeInTheDocument();
    });

    describe("through the queue", () => {
      const STAMP = "2026-10-20T18:00:00.000Z";
      const queue = {
        ...NO_QUEUE,
        ownerId: "u1",
        records: [] as QueuedVisit[],
        inFlight: new Set<string>(),
        enqueue: vi.fn((draft: VisitDraft) =>
          Promise.resolve(buildQueuedVisit(draft, "u1", Date.now(), () => "v-queued")),
        ),
      };
      const sent = (marked: string[]): QueuedVisit => ({
        ...buildQueuedVisit(
          { ...draftFor("#05-123"), sessionId: "s9" },
          "u1",
          Date.now(),
          () => "v-queued",
        ),
        state: "synced",
        serverVisit: {
          id: "v-queued",
          householdId: "h#05-123",
          sessionId: "s9",
          member: { id: "u1", name: "Me", image: null },
          team: null,
          interestLevel: "no_response",
          description: "",
          clientCreatedAt: STAMP,
          createdAt: STAMP,
          updatedAt: STAMP,
          followUpsMarkedDone: marked,
        },
      });

      beforeEach(() => {
        queue.records = [];
        queue.inFlight = new Set();
        useSyncQueue.mockImplementation(() => queue);
      });

      afterEach(() => {
        shellState.leave();
      });

      it("says it will be marked done once sent, then offers Undo once it is", async () => {
        const { view, status } = await saveAt();
        expect(status).toHaveTextContent(
          "Saved #05-123 on this phone.Follow-up marked done once sent.",
        );
        queue.inFlight = new Set(["v-queued"]);
        view.rerender(form());
        expect(status).toHaveTextContent("Sending #05-123…Follow-up marked done once sent.");

        queue.inFlight = new Set();
        queue.records = [sent(["n#05-123"])];
        view.rerender(form());
        expect(status).toHaveTextContent("Saved #05-123.Follow-up marked done.");
        expect(within(status).getByRole("button", { name: UNDO })).toBeEnabled();
        // Still held once sent, so the line does not shrink under the thumb.
        expect(status.firstElementChild).toHaveAttribute(
          "data-hold",
          "Saved #05\u2011123 on this phone.",
        );
        // At every width: nothing is offered beside the words at a listed door.
        expect(status.firstElementChild).toHaveClass("hold-text");
        expect(status.querySelector(".offer-row")).toBeNull();
      });

      /* Beside Undo, at large text the words were squeezed to one a line
         and "Follow-up" broke at its hyphen (#136). */
      it("sets Undo after the words it undoes, with Follow-up kept whole", async () => {
        const { view, status } = await saveAt();
        queue.records = [sent(["n#05-123"])];
        view.rerender(form());
        const undo = within(status).getByRole("button", { name: UNDO });
        expect(undo.closest("p")).toHaveTextContent(/^Follow-up marked done\. Undo/);
        expect(within(status).getByText("Follow-up")).toHaveClass("whole-word");
      });

      it("drops the line once sent if the server marked nothing", async () => {
        const { view, status } = await saveAt();
        queue.records = [sent([])];
        view.rerender(form());
        expect(status).not.toHaveTextContent(/marked done/);
      });

      it("never offers Undo on the offline shell", async () => {
        shellState.continueAs("u1");
        const { view, status } = await saveAt();
        queue.records = [sent(["n#05-123"])];
        view.rerender(form());
        expect(status).toHaveTextContent("Follow-up marked done.");
        expect(within(status).queryByRole("button", { name: /^Undo/ })).toBeNull();
      });
    });
  });

  describe("in a block with nothing on the session's list", () => {
    const ELSEWHERE = LIST.map((entry) => ({
      ...entry,
      block: { ...entry.block, id: "elsewhere" },
    }));
    const LINE = "Nothing in this block is on this session's list.";

    it("tells a member so, with the way back to the list, and keeps the form", async () => {
      const user = userEvent.setup();
      mount(ELSEWHERE);
      const line = screen.getByRole("status");
      expect(line).toHaveTextContent(
        `${LINE} Visits can be recorded only at the households on the session's list.`,
      );
      expect(within(line).getByRole("link", { name: "Back to the list" })).toHaveAttribute(
        "href",
        "/",
      );
      // Above the unit, and the form stays for what is already typed.
      const unit = screen.getByLabelText("Unit number");
      expect(line.compareDocumentPosition(unit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      await user.type(unit, "#05-123");
      expect(unit).toHaveValue("#05-123");
    });

    it("tells an empty list the same", () => {
      mount([]);
      expect(screen.getByRole("status")).toHaveTextContent(LINE);
    });

    it("says nothing to an admin, who may record anywhere", () => {
      useRole.mockReturnValue({ userId: "a1", isAdmin: true });
      mount(ELSEWHERE);
      expect(screen.queryByText(LINE)).toBeNull();
    });

    it("says nothing until the list is read, or when it cannot be", () => {
      mount(null);
      expect(screen.queryByText(LINE)).toBeNull();
      cleanup();
      render(
        <RecordVisitForm
          sessionId={null}
          loadSession={noSession}
          blockId={BLOCK}
          known={[]}
          followUp={{ revisits: undefined }}
          onRecorded={vi.fn()}
        />,
      );
      expect(screen.queryByText(LINE)).toBeNull();
    });

    it("says nothing where the block has households on the list", () => {
      mount();
      expect(screen.getByRole("list", { name: "On the list in this block" })).toBeVisible();
      expect(screen.queryByText(LINE)).toBeNull();
    });
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
      expect(screen.getByText(/is not on this session's list/)).toBeVisible();
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
      expect(screen.queryByText(/Could not check this session's list/)).toBeNull();
      expect(screen.queryByText(/is not on this session's list/)).toBeNull();
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
