import { describe, expect, it, vi } from "vitest";
import { createSignInLog, digestKey } from "@/server/auth/sign-in-log";

const EMAIL = "member@example.com";
const ADDRESS = "198.51.100.7";

describe("digestKey", () => {
  it("is stable within the process", () => {
    expect(digestKey("account", EMAIL)).toBe(digestKey("account", EMAIL));
  });

  it("differs by kind and by value", () => {
    expect(digestKey("account", EMAIL)).not.toBe(digestKey("client", EMAIL));
    expect(digestKey("account", EMAIL)).not.toBe(digestKey("account", "other@example.com"));
  });

  it("has a fixed length whatever the input, and carries none of it", () => {
    // A fixed size is what makes the limiter's key cap a memory bound.
    const long = `${"a".repeat(5000)}@example.com`;
    for (const value of [EMAIL, ADDRESS, long, ""]) {
      const digest = digestKey("account", value);
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      if (value !== "") {
        expect(digest).not.toContain(value);
      }
    }
  });

  it("is keyed, so it is not the plain SHA-256 anyone could compute from a guessed email", async () => {
    const { createHash } = await import("node:crypto");
    expect(digestKey("account", EMAIL)).not.toBe(
      createHash("sha256").update(`account:${EMAIL}`).digest("hex"),
    );
    expect(digestKey("account", EMAIL)).not.toBe(createHash("sha256").update(EMAIL).digest("hex"));
  });
});

describe("createSignInLog", () => {
  const clock = () => {
    let t = Date.parse("2026-11-03T10:00:00.000Z");
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it("writes one line for a burst of failures, then says how many it held back", () => {
    const time = clock();
    const log = vi.fn();
    const signInLog = createSignInLog({ log, now: time.now });

    for (let i = 0; i < 100; i += 1) {
      signInLog.failed(digestKey("account", `user-${String(i)}@example.com`));
    }
    expect(log).toHaveBeenCalledTimes(1);

    time.advance(60_000);
    signInLog.failed(digestKey("account", EMAIL));
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenLastCalledWith(
      expect.stringMatching(/\(99 similar suppressed since 10:00:00Z\)$/),
    );
  });

  it("shortens a failure's tag to its first 12 characters", () => {
    const log = vi.fn();
    const tag = digestKey("account", EMAIL);
    createSignInLog({ log }).failed(tag);
    expect(log).toHaveBeenCalledWith(
      `Sign-in failed: wrong email or password (account ${tag.slice(0, 12)})`,
    );
  });

  it("names the budget that refused, with a tag when it has one", () => {
    const log = vi.fn();
    const signInLog = createSignInLog({ log, quietMs: 0 });
    const tag = digestKey("client", ADDRESS);
    signInLog.limited("client", tag);
    signInLog.limited("global");
    expect(log.mock.calls).toEqual([
      [`Sign-in refused: the client attempt budget is spent (client ${tag.slice(0, 12)})`],
      ["Sign-in refused: the global attempt budget is spent"],
    ]);
  });

  it("throttles each kind of line on its own fixed key", () => {
    const log = vi.fn();
    const signInLog = createSignInLog({ log, now: () => 0 });
    for (let i = 0; i < 3; i += 1) {
      signInLog.failed(digestKey("account", `user-${String(i)}@example.com`));
      signInLog.oversized();
      signInLog.limited("account", digestKey("account", `user-${String(i)}@example.com`));
      signInLog.unattributed();
    }
    expect(log.mock.calls).toEqual([
      [expect.stringMatching(/^Sign-in failed: /)],
      ["Sign-in refused: an email or password longer than any account can have"],
      [expect.stringMatching(/^Sign-in refused: the account attempt budget is spent /)],
      [expect.stringMatching(/^Sign-in from no usable X-Forwarded-For entry: /)],
    ]);
  });

  it("defaults to console.warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    createSignInLog().oversized();
    expect(warn).toHaveBeenCalledWith(
      "Sign-in refused: an email or password longer than any account can have",
    );
    warn.mockRestore();
  });
});
