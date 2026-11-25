import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkCronBearer } from "@/server/privacy/cron";

const asking = (authorization?: string) =>
  new Request("https://test.local/api/retention/run", {
    ...(authorization === undefined ? {} : { headers: { authorization } }),
  });

describe("checkCronBearer", () => {
  const env = { CRON_SECRET: "s3cret-value-of-some-length" };

  it("lets the scheduler's secret through", () => {
    expect(() => {
      checkCronBearer(asking("Bearer s3cret-value-of-some-length"), env);
    }).not.toThrow();
  });

  it.each([
    ["no header", undefined],
    ["another scheme", "Basic czNjcmV0"],
    ["an empty bearer", "Bearer "],
    ["a wrong secret", "Bearer nope"],
    ["a longer secret", "Bearer s3cret-value-of-some-length-and-more"],
    ["a shorter secret", "Bearer s3cret"],
  ])("refuses %s", (_case, header) => {
    expect(() => {
      checkCronBearer(asking(header), env);
    }).toThrow(expect.objectContaining({ status: 401, code: "unauthenticated" }));
  });

  it("refuses everything when no secret is set, even an empty bearer", () => {
    expect(() => {
      checkCronBearer(asking("Bearer anything"), {});
    }).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => {
      checkCronBearer(asking("Bearer "), { CRON_SECRET: "" });
    }).toThrow(expect.objectContaining({ status: 401 }));
  });

  it("reads the secret from CRON_SECRET_FILE, without its trailing newline", () => {
    const file = join(mkdtempSync(join(tmpdir(), "cron-")), "secret");
    writeFileSync(file, "from-a-file\n");
    expect(() => {
      checkCronBearer(asking("Bearer from-a-file"), { CRON_SECRET_FILE: file });
    }).not.toThrow();
  });

  it("refuses when the secret's file cannot be read, rather than failing the request", () => {
    expect(() => {
      checkCronBearer(asking("Bearer x"), { CRON_SECRET_FILE: "/nowhere/at/all" });
    }).toThrow(expect.objectContaining({ status: 401 }));
  });

  it("refuses when both forms are set, as config does", () => {
    expect(() => {
      checkCronBearer(asking("Bearer a"), { CRON_SECRET: "a", CRON_SECRET_FILE: "/x" });
    }).toThrow(expect.objectContaining({ status: 401 }));
  });

  it("reads the process environment by default", () => {
    expect(() => {
      checkCronBearer(asking("Bearer whatever"));
    }).toThrow(expect.objectContaining({ status: 401 }));
  });

  it("passes on an error that is not the secret's", () => {
    const hostile = {
      get CRON_SECRET(): string {
        throw new RangeError("not a SecretError");
      },
    };
    expect(() => {
      checkCronBearer(asking("Bearer x"), hostile);
    }).toThrow(RangeError);
  });
});
