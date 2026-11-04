import { describe, expect, it, vi } from "vitest";
import { createThrottledLog, sanitizeMessage, summarizeError } from "@/server/logging/error-log";

const USER = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("sanitizeMessage", () => {
  it.each([
    ["connect ECONNREFUSED 10.0.0.12:5432", "connect ECONNREFUSED [host]"],
    ["connect ECONNREFUSED ::1:5433", "connect ECONNREFUSED [host]"],
    ["getaddrinfo ENOTFOUND db.internal:5432", "getaddrinfo ENOTFOUND [host]"],
    ["dial localhost:5433 failed", "dial [host] failed"],
    ["using postgresql://app:hunter2@db:5432/prod now", "using [url] now"],
    [`no user ${USER}`, "no user [id]"],
    ["sent to someone@example.com", "sent to [email]"],
    ["Key (email)=(Ana Lim) already exists.", "Key (email)=([value]) already exists."],
  ])("redacts %s", (raw, expected) => {
    expect(sanitizeMessage(raw)).toBe(expected);
  });

  it("drops everything after the first line, where drizzle puts the parameters", () => {
    expect(sanitizeMessage(`Failed query: select 1 where id = $1\nparams: ${USER}`)).toBe(
      "Failed query: select 1 where id = $1",
    );
  });

  it.each([
    ["a carriage return", "bad value\rforged line"],
    ["a line separator", "bad value\u2028forged line"],
    ["a paragraph separator", "bad value\u2029forged line"],
    ["CRLF", "bad value\r\nforged line"],
  ])("cuts at %s too, so a message cannot start a forged line", (_case, raw) => {
    expect(sanitizeMessage(raw)).toBe("bad value");
  });

  it("removes ESC and CR, so a message cannot recolour, retitle or overwrite a terminal line", () => {
    const line = sanitizeMessage("bad \x1b[31mred\x1b[0m \x1b]0;owned\x07 tail\rforged");
    expect(line).toBe("bad \uFFFD[31mred\uFFFD[0m \uFFFD]0;owned\uFFFD tail");
    expect(line).not.toContain("\x1b");
    expect(line).not.toContain("\r");
  });

  it.each([
    ["NUL", "\u0000"],
    ["a tab", "\t"],
    ["backspace", "\b"],
    ["DEL", "\u007f"],
    ["the C1 CSI", "\u009b"],
    ["C1 NEL", "\u0085"],
  ])("replaces %s with a visible mark", (_case, control) => {
    expect(sanitizeMessage(`a${control}b`)).toBe("a\uFFFDb");
  });

  it("caps a long message", () => {
    expect(sanitizeMessage("x".repeat(500))).toBe(`${"x".repeat(200)}...`);
  });

  it("leaves a plain pg message readable", () => {
    expect(sanitizeMessage("terminating connection due to administrator command")).toBe(
      "terminating connection due to administrator command",
    );
  });
});

describe("summarizeError", () => {
  it("gives name, code and a sanitised message, but none of the error's properties", () => {
    const error = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5433"), {
      code: "ECONNREFUSED",
      address: "127.0.0.1",
      port: 5433,
    });
    const line = summarizeError(error);
    expect(line).toBe("Error ECONNREFUSED: connect ECONNREFUSED [host]");
    expect(line).not.toMatch(/127\.0\.0\.1|5433/);
  });

  it("borrows the cause's code but never its message or the query parameters", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED 10.1.2.3:5432"), {
      code: "ECONNREFUSED",
    });
    const wrapped = new Error(`Failed query: select * from users where id = $1\nparams: ${USER}`, {
      cause,
    });
    wrapped.name = "DrizzleQueryError";
    const line = summarizeError(wrapped);
    expect(line).toBe(
      "DrizzleQueryError ECONNREFUSED: Failed query: select * from users where id = $1",
    );
    expect(line).not.toContain(USER);
    expect(line).not.toContain("10.1.2.3");
  });

  it("omits the code when there is none", () => {
    expect(summarizeError(new TypeError("bad"))).toBe("TypeError: bad");
  });

  it("does not trust a thrown non-Error", () => {
    expect(summarizeError({ password: "hunter2" })).toBe("unknown error");
  });
});

describe("createThrottledLog", () => {
  it("logs a burst once, then the count and when it started", () => {
    let t = Date.parse("2026-03-14T10:00:00.000Z");
    const log = vi.fn();
    const report = createThrottledLog({ log, now: () => t });

    for (let i = 0; i < 39; i += 1) report("db", "down");
    expect(log).toHaveBeenCalledTimes(1);

    t += 3 * 60 * 60 * 1000;
    report("db", "down again");
    expect(log).toHaveBeenLastCalledWith("down again (38 similar suppressed since 10:00:00Z)");
  });

  it("adds no count when nothing was suppressed", () => {
    let t = 0;
    const log = vi.fn();
    const report = createThrottledLog({ log, now: () => t });
    report("db", "one");
    t = 10_000;
    report("db", "two");
    expect(log.mock.calls).toEqual([["one"], ["two"]]);
  });

  it("throttles each key on its own", () => {
    const log = vi.fn();
    const report = createThrottledLog({ log, now: () => 0 });
    report("a", "first");
    report("b", "second");
    report("a", "again");
    expect(log.mock.calls).toEqual([["first"], ["second"]]);
  });

  it("honours a custom quiet window", () => {
    let t = 0;
    const log = vi.fn();
    const report = createThrottledLog({ log, now: () => t, quietMs: 100 });
    report("a", "one");
    t = 150;
    report("a", "two");
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("defaults to console.error and the real clock", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const report = createThrottledLog();
    report("a", "one");
    report("a", "two");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("one");
    spy.mockRestore();
  });
});
