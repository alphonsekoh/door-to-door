import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutingSession } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";
import { chooseTarget, loadTarget, targetCaption } from "@/lib/follow-ups/target-session";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

function session(id: string, status: OutingSession["status"], createdAt: string): OutingSession {
  return {
    id,
    title: id,
    kind: "follow_up",
    status,
    startedAt: null,
    endedAt: null,
    createdBy: { id: "a", name: "Admin", image: null },
    createdAt,
  };
}

const running = session("running", "active", "2026-10-01T00:00:00.000Z");
const older = session("older", "draft", "2026-10-02T00:00:00.000Z");
const newer = session("newer", "draft", "2026-10-03T00:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("chooseTarget", () => {
  it("prefers the session running now", () => {
    expect(chooseTarget([running], [newer])).toBe(running);
  });

  it("falls back to the newest one not started", () => {
    expect(chooseTarget([], [older, newer])).toBe(newer);
  });

  it("is none when there is no follow-up session to add to", () => {
    expect(chooseTarget([], [])).toBeNull();
  });
});

describe("loadTarget", () => {
  it("asks for the running follow-up session and the newest draft", async () => {
    apiFetch.mockImplementation((path: string) =>
      Promise.resolve({ data: path.includes("status=active") ? [] : [newer] }),
    );
    expect(await loadTarget()).toBe(newer);
    expect(apiFetch.mock.calls.map(([path]) => String(path)).sort()).toEqual([
      "/sessions?status=active&kind=follow_up&limit=1",
      "/sessions?status=draft&kind=follow_up&limit=1",
    ]);
  });
});

describe("targetCaption", () => {
  it("says who will see it, and when", () => {
    expect(targetCaption(running)).toBe("Running now. Members will see it on their list.");
    expect(targetCaption(newer)).toBe("A follow-up session that hasn't started yet.");
  });
});
