import { describe, expect, it } from "vitest";
import { CreateAdminError } from "@/server/users/first-admin";
import { USAGE, parseCreateAdminArgs } from "@/server/users/create-admin-cli";

describe("parseCreateAdminArgs", () => {
  it("reads and normalises the email and name", () => {
    expect(parseCreateAdminArgs(["--email", " Lead@Example.org", "--name", " Lead "])).toEqual({
      email: "lead@example.org",
      name: "Lead",
    });
  });

  it("accepts the --email=value form and makes the name optional", () => {
    expect(parseCreateAdminArgs(["--email=lead@example.org"])).toEqual({
      email: "lead@example.org",
      name: null,
    });
  });

  it.each([["--password", "hunter22"], ["--password=hunter22"]])(
    "refuses a password flag and says where a password may come from (%s)",
    (...argv) => {
      const run = () => parseCreateAdminArgs(["--email", "lead@example.org", ...argv]);
      expect(run).toThrow(CreateAdminError);
      expect(run).toThrow(/never taken as an argument.*ADMIN_PASSWORD/);
    },
  );

  it("requires an email and shows the usage", () => {
    expect(() => parseCreateAdminArgs([])).toThrow(`The admin's email is required.\n${USAGE}`);
  });

  it("refuses an unknown option or stray argument with the usage", () => {
    expect(() => parseCreateAdminArgs(["--email", "a@b.org", "--role", "member"])).toThrow(
      /--role[\s\S]*Usage: npm run create-admin/,
    );
    expect(() => parseCreateAdminArgs(["--email", "a@b.org", "extra"])).toThrow(CreateAdminError);
  });

  it("refuses an invalid email or name before any password is asked for", () => {
    expect(() => parseCreateAdminArgs(["--email", "nope"])).toThrow(/not a valid email/);
    expect(() => parseCreateAdminArgs(["--email", "a@b.org", "--name", "..."])).toThrow(
      /at least one letter or number/,
    );
  });
});
