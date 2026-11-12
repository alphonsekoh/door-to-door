import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as AccountStateModule from "@/lib/session/account-state";
import { ApiRequestError, apiFetch } from "@/lib/api-client";

const { reportAuthFailure } = vi.hoisted(() => ({ reportAuthFailure: vi.fn() }));
vi.mock("@/lib/session/account-state", async () => ({
  ...(await vi.importActual<typeof AccountStateModule>("@/lib/session/account-state")),
  accountStore: { reportAuthFailure },
}));

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

beforeEach(() => {
  reportAuthFailure.mockClear();
});

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

  it("carries the fields a 400 refused, so a form can point at them", async () => {
    const details = [{ path: "/unitNumber", message: "Invalid string: must match pattern /\\S/" }];
    respond(400, {
      error: { code: "validation_failed", message: "Invalid request body.", details },
    });
    await expect(apiFetch("/visits")).rejects.toMatchObject({ status: 400, details });
  });

  it("carries no fields when the body names none, or is not JSON", async () => {
    respond(409, { error: { code: "conflict", message: "Taken." } });
    await expect(apiFetch("/visits")).rejects.toMatchObject({ details: [] });
    respond(502, undefined);
    await expect(apiFetch("/visits")).rejects.toMatchObject({ details: [] });
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

  it("passes on a code this build does not know, with the server's words", async () => {
    // A phone can run an older build against a newer server.
    respond(409, { error: { code: "some_later_code", message: "Newer words." } });
    await expect(apiFetch("/x")).rejects.toMatchObject({
      status: 409,
      code: "some_later_code",
      message: "Newer words.",
    });
  });

  describe("an answer from outside the contract", () => {
    // A proxy, Auth.js or the platform can answer without withContract's
    // envelope (#165). Real Responses, so parsing is the platform's.
    const answer = (response: Response) =>
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    const failure = () => apiFetch("/visits").catch((caught: unknown) => caught);
    const generic = (status: number) => ({
      status,
      code: "internal_error",
      message: "Something went wrong.",
      details: [],
    });

    it.each([
      ["no envelope", 413, { message: "Request Entity Too Large" }],
      ["an empty object", 500, {}],
      ["an error that is a string", 403, { error: "Forbidden" }],
      ["an error that is null", 502, { error: null }],
      ["an error without a code", 404, { error: { message: "Proxy words." } }],
      ["an error without a message", 409, { error: { code: "conflict" } }],
      ["an error whose message is not text", 409, { error: { code: "conflict", message: 7 } }],
      ["null", 503, null],
      ["a string", 502, "Bad Gateway"],
      ["an array", 400, [{ error: { code: "conflict", message: "Taken." } }]],
    ])("keeps the status of JSON with %s, and says something generic", async (_, status, body) => {
      answer(json(status, body));
      const error = await failure();
      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error).toMatchObject(generic(status));
    });

    it("keeps the status of an HTML page, and says something generic", async () => {
      answer(new Response("<html><body>Bad gateway</body></html>", { status: 502 }));
      const error = await failure();
      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error).toMatchObject(generic(502));
    });

    it("keeps the status of an empty body, and says something generic", async () => {
      answer(new Response(null, { status: 405 }));
      const error = await failure();
      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error).toMatchObject(generic(405));
    });

    it("passes on only the field issues a form can read", async () => {
      const issue = { path: "/unitNumber", message: "Too long." };
      answer(
        json(400, {
          error: {
            code: "validation_failed",
            message: "Invalid request body.",
            details: [issue, null, "/note", { message: "No path." }, { path: "/note", message: 3 }],
          },
        }),
      );
      expect(await failure()).toMatchObject({ code: "validation_failed", details: [issue] });
    });

    it("carries no field issues when they are not a list", async () => {
      answer(
        json(400, {
          error: { code: "validation_failed", message: "Invalid.", details: { path: "/note" } },
        }),
      );
      expect(await failure()).toMatchObject({ code: "validation_failed", details: [] });
    });

    it("still raises the account message for a 401 outside the envelope", async () => {
      answer(json(401, { message: "Unauthorized" }));
      expect(await failure()).toMatchObject(generic(401));
      expect(reportAuthFailure).toHaveBeenCalledWith("signed-out");
    });
  });

  describe("reporting a session the server no longer accepts", () => {
    it("reports a deactivated account and still throws to the caller", async () => {
      respond(403, { error: { code: "account_deactivated", message: "Deactivated." } });
      await expect(apiFetch("/x")).rejects.toMatchObject({ status: 403 });
      expect(reportAuthFailure).toHaveBeenCalledWith("deactivated");
    });

    it("reports a 401 as signed out and still throws an ApiRequestError", async () => {
      respond(401, { error: { code: "unauthenticated", message: "Sign in." } });
      await expect(apiFetch("/x")).rejects.toBeInstanceOf(ApiRequestError);
      expect(reportAuthFailure).toHaveBeenCalledWith("signed-out");
    });

    it("reports a 401 whose body is not JSON", async () => {
      respond(401, undefined);
      await expect(apiFetch("/x")).rejects.toMatchObject({ status: 401 });
      expect(reportAuthFailure).toHaveBeenCalledWith("signed-out");
    });

    it("does not report a plain 403 or a server error", async () => {
      respond(403, { error: { code: "forbidden", message: "No." } });
      await expect(apiFetch("/x")).rejects.toMatchObject({ status: 403 });
      respond(500, undefined);
      await expect(apiFetch("/x")).rejects.toMatchObject({ status: 500 });
      expect(reportAuthFailure).not.toHaveBeenCalled();
    });

    it("does not report a success", async () => {
      respond(200, {});
      await apiFetch("/x");
      expect(reportAuthFailure).not.toHaveBeenCalled();
    });
  });
});
