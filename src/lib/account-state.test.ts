import { describe, expect, it, vi } from "vitest";
import { classifyAuthFailure, createAccountStore } from "@/lib/account-state";

describe("classifyAuthFailure", () => {
  it("treats any 401 as signed out, whatever the code", () => {
    expect(classifyAuthFailure(401, "unauthenticated")).toBe("signed-out");
    expect(classifyAuthFailure(401, "internal_error")).toBe("signed-out");
    expect(classifyAuthFailure(401, undefined)).toBe("signed-out");
  });

  it("treats a 403 account_deactivated as deactivated", () => {
    expect(classifyAuthFailure(403, "account_deactivated")).toBe("deactivated");
  });

  it("leaves a plain 403 to the screen that asked", () => {
    // A refused team change or a demoted admin's route is not an account problem.
    expect(classifyAuthFailure(403, "forbidden")).toBeNull();
  });

  it("ignores every other status", () => {
    expect(classifyAuthFailure(404, "not_found")).toBeNull();
    expect(classifyAuthFailure(500, "account_deactivated")).toBeNull();
  });
});

describe("createAccountStore", () => {
  it("starts with nothing known", () => {
    expect(createAccountStore().getSnapshot()).toEqual({ failure: null, serverUser: null });
  });

  it("keeps the first failure reported until the page is reloaded", () => {
    const store = createAccountStore();
    store.reportAuthFailure("deactivated");
    store.reportAuthFailure("signed-out");
    expect(store.getSnapshot().failure).toBe("deactivated");
  });

  it("tells subscribers about a failure, and stops once they unsubscribe", () => {
    const store = createAccountStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.reportAuthFailure("signed-out");
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    store.noteCurrentUser({ id: "u1", role: "member" });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("does not notify for a failure that changes nothing", () => {
    const store = createAccountStore();
    store.reportAuthFailure("signed-out");
    const listener = vi.fn();
    store.subscribe(listener);
    store.reportAuthFailure("deactivated");
    expect(listener).not.toHaveBeenCalled();
  });

  it("records the latest user the server described, without the failure", () => {
    const store = createAccountStore();
    const before = store.getSnapshot();
    store.noteCurrentUser({ id: "u1", role: "admin" });
    store.noteCurrentUser({ id: "u1", role: "member" });
    expect(store.getSnapshot()).toEqual({
      failure: null,
      serverUser: { id: "u1", role: "member" },
    });
    // A new object, so useSyncExternalStore sees the change.
    expect(store.getSnapshot()).not.toBe(before);
  });

  it("copies only the id and role from a full user record", () => {
    const store = createAccountStore();
    const user = { id: "u1", role: "admin" as const, name: "Ann", email: "a@x.test" };
    store.noteCurrentUser(user);
    expect(store.getSnapshot().serverUser).toEqual({ id: "u1", role: "admin" });
  });

  it("always describes a blank slate to the server render", () => {
    const store = createAccountStore();
    store.reportAuthFailure("deactivated");
    store.noteCurrentUser({ id: "u1", role: "member" });
    expect(store.getServerSnapshot()).toEqual({ failure: null, serverUser: null });
  });
});
