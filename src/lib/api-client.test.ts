import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, apiFetch } from "@/lib/api-client";

const respond = (status: number, body?: unknown, ok = status < 400) =>
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: () =>
        body === undefined ? Promise.reject(new Error("no body")) : Promise.resolve(body),
    }),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("returns the parsed body", async () => {
    respond(200, { id: "s1" });
    expect(await apiFetch("/sessions/active")).toEqual({ id: "s1" });
  });

  it("prefixes /api so callers write contract paths", async () => {
    respond(200, {});
    await apiFetch("/sessions/active");
    expect(fetch).toHaveBeenCalledWith("/api/sessions/active", expect.anything());
  });

  it("returns undefined for a 204", async () => {
    respond(204, undefined, true);
    expect(await apiFetch("/follow-ups/1")).toBeUndefined();
  });

  it("throws with the contract's error code", async () => {
    respond(404, { error: { code: "not_found", message: "No session is active." } });
    await expect(apiFetch("/sessions/active")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
      message: "No session is active.",
    });
  });

  it("still reports the status when the body is not JSON", async () => {
    // A proxy or a crash can return HTML; the status must survive.
    respond(502, undefined);
    await expect(apiFetch("/sessions/active")).rejects.toMatchObject({ status: 502 });
  });

  it("falls back to a readable message", async () => {
    respond(500, undefined);
    await expect(apiFetch("/x")).rejects.toThrow("Something went wrong.");
  });

  it("is an ApiRequestError, so callers can branch on the code", async () => {
    respond(403, { error: { code: "forbidden", message: "No." } });
    await expect(apiFetch("/x")).rejects.toBeInstanceOf(ApiRequestError);
  });
});
