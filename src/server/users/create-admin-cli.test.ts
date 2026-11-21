import { describe, expect, it } from "vitest";
import { CreateAdminError } from "@/server/users/first-admin";
import { USAGE, describeCreated, parseCreateAdminArgs } from "@/server/users/create-admin-cli";

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

describe("describeCreated", () => {
  const made = { id: "00000000-0000-4000-8000-000000000001", email: "lead@gmail.com" };

  it("says how the new admin signs in", () => {
    expect(describeCreated({ ...made, googleOnly: false, fromRequest: false })).toBe(
      "Created admin lead@gmail.com. Sign in with that email and the password given.",
    );
    expect(describeCreated({ ...made, googleOnly: true, fromRequest: false })).toBe(
      "Created admin lead@gmail.com. Sign in with Google as lead@gmail.com.",
    );
  });

  it("says when the admin was a request to join with Google, so a mistyped address shows (#249)", () => {
    expect(describeCreated({ ...made, googleOnly: true, fromRequest: true })).toBe(
      "lead@gmail.com had asked to join with Google, and is now the admin. " +
        "Sign in with Google as lead@gmail.com.",
    );
  });
});
