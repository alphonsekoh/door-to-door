import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordVisitForm } from "@/components/visits/record-visit-form";
import type { HouseholdHistory, HouseholdSummary, RevisitEntry } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";
import { formatDayTime } from "@/lib/history/dates";
import { shellState } from "@/lib/offline/shell-state";
import type { OutingAnswer } from "@/lib/sync/outing";
import {
  BLOCK_ID,
  entryFor,
  history,
  queuedRecord,
  thread,
  visit,
} from "../../../test/thread-fixtures";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));

const { useOnline } = vi.hoisted(() => ({ useOnline: vi.fn() }));
vi.mock("@/lib/hooks/use-online", () => ({ useOnline }));

const { useSyncQueue } = vi.hoisted(() => ({ useSyncQueue: vi.fn() }));
vi.mock("@/components/sync/sync-provider", () => ({ useSyncQueue }));

const QUEUE = {
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

const noSession = vi.fn((): Promise<OutingAnswer> => Promise.resolve({ kind: "unknown" }));
const REGION = "What we know about this unit";

const summaryOf = (h: HouseholdHistory): HouseholdSummary => ({
  household: h.household,
  visitCount: h.visits.length,
  latestVisit: h.visits[0] ?? null,
  outstandingFollowUps: 0,
});

const READ_AT = Date.parse("2026-10-15T08:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  useRole.mockReturnValue({ userId: "u1", isAdmin: false });
  useOnline.mockReturnValue(true);
  useSyncQueue.mockReturnValue(QUEUE);
  apiFetch.mockReturnValue(new Promise(() => undefined));
});

afterEach(() => {
  shellState.leave();
});

type Mount = {
  revisits?: RevisitEntry[] | null | "unread";
  threads?: ReturnType<typeof thread>[];
  onThreadRead?: (history: HouseholdHistory) => void;
  followUp?: boolean;
  unit?: string;
};

function mount({
  revisits = [entryFor(history(1))],
  threads = [],
  onThreadRead,
  followUp = true,
  unit = "#05-01",
}: Mount = {}) {
  return render(
    <RecordVisitForm
      sessionId={null}
      loadSession={noSession}
      blockId={BLOCK_ID}
      known={[summaryOf(history(1)), summaryOf(history(2))]}
      followUp={followUp ? { revisits: revisits === "unread" ? undefined : revisits } : null}
      initialUnit={unit}
      onRecorded={vi.fn()}
      threads={threads}
      {...(onThreadRead === undefined ? {} : { onThreadRead })}
    />,
  );
}

const follows = (a: Node, b: Node) =>
  a.compareDocumentPosition(b) === Node.DOCUMENT_POSITION_FOLLOWING;

describe("a unit's thread in a follow-up session's form", () => {
  it("sits under the chips and above the interest level when the phone holds it", () => {
    mount({ threads: [thread(1, READ_AT)] });
    const region = screen.getByRole("region", { name: REGION });
    const chips = screen.getByRole("list", { name: "On the list in this block" });
    const interest = screen.getByText("Interest level");
    expect(follows(chips, region)).toBe(true);
    expect(follows(region, interest)).toBe(true);
    expect(screen.getAllByRole("region", { name: REGION })).toHaveLength(1);
    expect(within(region).getByText("Come back on Sunday")).toBeInTheDocument();
  });

  it("opens from the unit's own read when the phone holds none", async () => {
    apiFetch.mockResolvedValue(history(1));
    mount();
    const region = await screen.findByRole("region", { name: REGION });
    expect(follows(region, screen.getByText("Interest level"))).toBe(true);
    expect(screen.getAllByRole("region", { name: REGION })).toHaveLength(1);
  });

  it("keeps the history last for a unit off the list", async () => {
    apiFetch.mockResolvedValue(history(2));
    mount({ unit: "#05-02" });
    const region = await screen.findByRole("region", { name: REGION });
    expect(follows(screen.getByText("Interest level"), region)).toBe(true);
  });

  it("keeps the history last until the list is known", async () => {
    apiFetch.mockResolvedValue(history(1));
    mount({ revisits: "unread" });
    const region = await screen.findByRole("region", { name: REGION });
    expect(follows(screen.getByText("Interest level"), region)).toBe(true);
  });

  it("keeps the history last in a door-to-door session, which is given no threads", async () => {
    apiFetch.mockResolvedValue(history(1));
    mount({ followUp: false });
    const region = await screen.findByRole("region", { name: REGION });
    expect(follows(screen.getByText("Interest level"), region)).toBe(true);
    expect(region).not.toHaveTextContent("As last read with signal");
  });

  it("replaces the stored thread with the unit's fresh read, with no age line, and hands it on", async () => {
    const [first] = history(1).visits;
    const fresh = history(1, [
      visit("0190a000-0000-7000-8000-0000000000b1", { description: "Teammate went at 8pm" }),
      ...(first === undefined ? [] : [first]),
    ]);
    apiFetch.mockResolvedValue(fresh);
    const onThreadRead = vi.fn();
    mount({
      threads: [thread(1, READ_AT)],
      onThreadRead,
    });
    expect(screen.getByText("Come back on Sunday")).toBeInTheDocument();
    expect(await screen.findByText("Teammate went at 8pm")).toBeInTheDocument();
    expect(screen.getAllByText("Come back on Sunday")).toHaveLength(1);
    expect(screen.queryByText(/As last read with signal/)).not.toBeInTheDocument();
    expect(onThreadRead).toHaveBeenCalledWith(fresh);
  });

  it("says when the stored thread was read when the unit's own read fails", async () => {
    apiFetch.mockRejectedValue(new Error("no signal"));
    mount({ threads: [thread(1, READ_AT)] });
    expect(
      await screen.findByText(`As last read with signal, ${formatDayTime(READ_AT)}.`),
    ).toBeInTheDocument();
    expect(screen.getByText("Come back on Sunday")).toBeInTheDocument();
  });

  it("says it on the offline shell while the read has not come, and not once it has", async () => {
    shellState.enter();
    let answer: (value: HouseholdHistory) => void = () => undefined;
    apiFetch.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    mount({ threads: [thread(1, READ_AT)] });
    expect(
      screen.getByText(`As last read with signal, ${formatDayTime(READ_AT)}.`),
    ).toBeInTheDocument();
    await act(async () => {
      answer(history(1));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByText(/As last read with signal/)).not.toBeInTheDocument();
    });
  });

  it("shows this phone's own record at the top, not sent yet", () => {
    useSyncQueue.mockReturnValue({ ...QUEUE, records: [queuedRecord("#05-01")] });
    mount({ threads: [thread(1, READ_AT)] });
    const items = within(screen.getByRole("list", { name: "Timeline" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("You");
    expect(items[0]).toHaveTextContent("Not sent yet");
    expect(items[0]).toHaveTextContent("Asked us in");
    expect(items[1]).toHaveTextContent("Ben Lim");
  });

  it("names the religion when it is known and says nothing of it when it is not", () => {
    const known = { ...history(1, undefined, "hindu") };
    const { unmount } = mount({ threads: [{ history: known, savedAt: READ_AT }] });
    expect(
      within(screen.getByRole("region", { name: REGION })).getByText("Religion: Hindu"),
    ).toBeVisible();
    unmount();
    mount({ threads: [thread(1, READ_AT)] });
    expect(screen.getByRole("region", { name: REGION })).not.toHaveTextContent("Religion");
  });

  it("shows no thread until a listed unit is picked", async () => {
    const user = userEvent.setup();
    mount({ threads: [thread(1, READ_AT)], unit: "" });
    expect(screen.queryByRole("region", { name: REGION })).not.toBeInTheDocument();
    const chips = screen.getByRole("list", { name: "On the list in this block" });
    await user.click(within(chips).getAllByRole("button")[0] ?? chips);
    expect(screen.getByRole("region", { name: REGION })).toBeInTheDocument();
  });
});
