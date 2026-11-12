import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import type * as SignIns from "@/server/auth/sign-ins";
import { SIGN_OUT_FAILED_URL, endThisSignIn, failUnendedSignOut } from "@/server/auth/sign-out";

const { endSignIn } = vi.hoisted(() => ({ endSignIn: vi.fn() }));
vi.mock("@/server/auth/sign-ins", async (importOriginal) => ({
  ...(await importOriginal<typeof SignIns>()),
  endSignIn,
}));

const db = {} as Database;
const USER = "11111111-0000-4000-8000-000000000001";
const SIGN_IN = "22222222-0000-4000-8000-000000000002";
type Message = Parameters<ReturnType<typeof endThisSignIn>>[0];
const token: Message = { token: { sub: USER, signInId: SIGN_IN } };

/* Auth.js's signOut event for `request`, fired with `message`. */
const fire = (request: Request, message: Message = token) =>
  Promise.resolve(endThisSignIn(db, request)(message));

const signOutRequest = () => new Request("https://test.local/api/auth/signout", { method: "POST" });

/* What Auth.js answers a sign-out with, whatever its event did (R-143). */
const cleared = () =>
  new Response(JSON.stringify({ url: "https://test.local/account" }), {
    headers: {
      "content-type": "application/json",
      "set-cookie": "__Secure-authjs.session-token=; Max-Age=0; Path=/",
    },
  });

/* Auth.js's handler, firing the event as its sign-out does, then answering. */
const authJs = (request: Request) => async () => {
  await fire(request).catch(() => undefined);
  return cleared();
};

describe("signing out (#125, #162)", () => {
  it("passes Auth.js's answer through once the sign-in has ended", async () => {
    endSignIn.mockResolvedValue(undefined);
    const request = signOutRequest();
    const response = await failUnendedSignOut(authJs(request))(request);

    expect(endSignIn).toHaveBeenCalledWith(db, USER, SIGN_IN);
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toHaveLength(1);
  });

  it("fails in place of Auth.js's answer when the sign-in could not be ended, keeping the cookie", async () => {
    endSignIn.mockRejectedValue(new Error("connection lost"));
    const request = signOutRequest();
    const response = await failUnendedSignOut(authJs(request))(request);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ url: SIGN_OUT_FAILED_URL });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("hands the error on, for Auth.js to log", async () => {
    endSignIn.mockRejectedValue(new Error("connection lost"));
    await expect(fire(signOutRequest())).rejects.toThrow("connection lost");
  });

  it("fails only the sign-out that could not end its sign-in", async () => {
    endSignIn.mockRejectedValueOnce(new Error("connection lost"));
    const failed = signOutRequest();
    await fire(failed).catch(() => undefined);

    const other = signOutRequest();
    expect((await failUnendedSignOut(() => Promise.resolve(cleared()))(other)).status).toBe(200);
  });

  it.each<[string, Message]>([
    ["no token", { token: null }],
    ["a token naming nobody", { token: { signInId: SIGN_IN } }],
    ["a database session, which this app never has", { session: null }],
  ])("ends nothing, and fails nothing, for %s", async (_name, message) => {
    endSignIn.mockClear();
    const request = signOutRequest();
    await fire(request, message);
    expect(endSignIn).not.toHaveBeenCalled();
    expect((await failUnendedSignOut(() => Promise.resolve(cleared()))(request)).status).toBe(200);
  });
});
