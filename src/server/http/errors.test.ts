import { describe, expect, it } from "vitest";
import {
  AccountDeactivatedError,
  ApiError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  ClockSkewError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from "@/server/http/errors";

describe("status and code mapping", () => {
  it.each([
    [new ValidationError(), 400, "validation_failed"],
    [new UnauthenticatedError(), 401, "unauthenticated"],
    [new ForbiddenError(), 403, "forbidden"],
    [new AccountDeactivatedError(), 403, "account_deactivated"],
    [new NotFoundError(), 404, "not_found"],
    [new ConflictError(), 409, "conflict"],
    [new ClockSkewError(), 422, "clock_skew"],
    [new RateLimitedError(), 429, "rate_limited"],
    [new InternalError(), 500, "internal_error"],
  ])("maps to %s", (error, status, code) => {
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(error).toBeInstanceOf(ApiError);
  });

  it("keeps a distinct name per error, so logs identify the cause", () => {
    expect(new NotFoundError().name).toBe("NotFoundError");
    expect(new AccountDeactivatedError().name).toBe("AccountDeactivatedError");
  });
});

describe("default messages", () => {
  it.each([
    [new ValidationError(), /validation/i],
    [new UnauthenticatedError(), /sign in/i],
    [new ForbiddenError(), /do not have access/i],
    [new AccountDeactivatedError(), /deactivated/i],
    [new NotFoundError(), /not found/i],
    [new ConflictError(), /conflicts/i],
    [new ClockSkewError(), /clock/i],
    [new RateLimitedError(), /too many/i],
    [new InternalError(), /went wrong/i],
  ])("reads as something a user could be shown", (error, pattern) => {
    expect(error.message).toMatch(pattern);
  });

  it("accepts an override", () => {
    expect(new NotFoundError("No such block.").message).toBe("No such block.");
    expect(new UnauthenticatedError("Session expired.").message).toBe("Session expired.");
    expect(new ForbiddenError("Admins only.").message).toBe("Admins only.");
    expect(new AccountDeactivatedError("Ask an admin.").message).toBe("Ask an admin.");
    expect(new RateLimitedError("Slow down.").message).toBe("Slow down.");
    expect(new InternalError("Boom.").message).toBe("Boom.");
    expect(new ValidationError("Bad input.").message).toBe("Bad input.");
  });
});

describe("conflict codes", () => {
  it("defaults to the generic conflict code", () => {
    expect(new ConflictError().code).toBe("conflict");
  });

  it("carries a specific code, so clients can tell cases apart", () => {
    // Starting a session while another is active is not the same failure as
    // detaching a block that has visits.
    expect(new ConflictError("session_already_active").code).toBe("session_already_active");
    expect(new ConflictError("block_in_use", "That block has visits.").message).toBe(
      "That block has visits.",
    );
  });
});

describe("toBody", () => {
  it("wraps in the contract's error envelope", () => {
    expect(new NotFoundError("Gone.").toBody()).toEqual({
      error: { code: "not_found", message: "Gone." },
    });
  });

  it("includes details when present", () => {
    const details = [{ path: "/unitNumber", message: "Required" }];
    expect(new ValidationError("Bad.", details).toBody()).toEqual({
      error: { code: "validation_failed", message: "Bad.", details },
    });
  });

  it("omits details entirely rather than sending an empty array", () => {
    expect(new NotFoundError().toBody().error).not.toHaveProperty("details");
  });
});
