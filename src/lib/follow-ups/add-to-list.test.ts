import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutingSession } from "@/generated/types.gen";
import type * as ApiClientModule from "@/lib/api-client";
import { ApiRequestError } from "@/lib/api-client";
import {
  ADDED_TO_LIST,
  addedMessage,
  intoSession,
  listThenAdd,
  partialMessage,
} from "@/lib/follow-ups/add-to-list";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const TARGET = { id: "s1", title: "Saturday revisits" } as OutingSession;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listThenAdd", () => {
  it("lists the door alone when there is no session to add it to", async () => {
    const list = vi.fn().mockResolvedValue({});
    expect(await listThenAdd(list, "h1", null)).toEqual({ status: "done", message: ADDED_TO_LIST });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("lists the door, then adds it to the session", async () => {
    const list = vi.fn().mockResolvedValue({});
    apiFetch.mockResolvedValue({});
    expect(await listThenAdd(list, "h1", TARGET)).toEqual({
      status: "done",
      message: "Added to the follow-up list and to Saturday revisits.",
    });
    expect(apiFetch).toHaveBeenCalledWith("/sessions/s1/households", {
      method: "POST",
      body: JSON.stringify({ householdIds: ["h1"] }),
    });
  });

  it("never asks the session to take a door the list refused", async () => {
    const refused = new Error("refused");
    await expect(listThenAdd(() => Promise.reject(refused), "h1", TARGET)).rejects.toBe(refused);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("says the door is listed when only the session step fails", async () => {
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await listThenAdd(() => Promise.resolve({}), "h1", TARGET)).toEqual({
      status: "partial",
      half: { target: TARGET, refused: null },
    });
  });
});

const ENDED = "This session has ended, so its households can no longer change. Reopen it first.";
const answer = (status: number, message: string) =>
  new ApiRequestError(status, { error: { code: "conflict", message } });

describe("intoSession", () => {
  it("adds the door to the session alone, as a retry does", async () => {
    apiFetch.mockResolvedValue({});
    expect(await intoSession(TARGET, "h1")).toEqual({
      status: "done",
      message: "Added to the follow-up list and to Saturday revisits.",
    });
  });

  it("keeps the server's reason when it turns the door away, so no retry is offered", async () => {
    apiFetch.mockRejectedValue(answer(409, ENDED));
    expect(await intoSession(TARGET, "h1")).toEqual({
      status: "partial",
      half: { target: TARGET, refused: ENDED },
    });
  });

  it.each([
    ["a lost connection", new TypeError("Failed to fetch")],
    ["a server fault", answer(503, "Something went wrong.")],
    ["too many requests", answer(429, "Slow down.")],
  ])("leaves %s to a retry", async (_, error) => {
    apiFetch.mockRejectedValue(error);
    expect(await intoSession(TARGET, "h1")).toEqual({
      status: "partial",
      half: { target: TARGET, refused: null },
    });
  });
});

describe("the words", () => {
  it("say what was done, and what to do when half of it was", () => {
    expect(addedMessage(null)).toBe("Added to the follow-up list.");
    expect(addedMessage(TARGET)).toBe("Added to the follow-up list and to Saturday revisits.");
    expect(partialMessage({ target: TARGET, refused: null })).toBe(
      "Added to the follow-up list, but not to Saturday revisits. Try again, or add it from the session's page.",
    );
  });

  it("give the server's reason in place of a retry it would refuse", () => {
    expect(partialMessage({ target: TARGET, refused: ENDED })).toBe(
      `Added to the follow-up list, but not to Saturday revisits. ${ENDED}`,
    );
  });
});
