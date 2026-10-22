import { beforeEach, describe, expect, it, vi } from "vitest";

const { NextAuth, buildAuthConfig, config, instance } = vi.hoisted(() => {
  const config = { providers: [] };
  const instance = {
    handlers: { GET: vi.fn(), POST: vi.fn() },
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  };
  return {
    config,
    instance,
    NextAuth: vi.fn((_config: () => unknown) => instance),
    buildAuthConfig: vi.fn(() => config),
  };
});

vi.mock("next-auth", () => ({ default: NextAuth }));
vi.mock("@/server/auth/config", () => ({ buildAuthConfig }));

/*
 * Building the config reads config.yaml and constructs the Drizzle adapter.
 * `next build` imports this module with neither a config file nor a database,
 * so a config built at import fails the build.
 */
describe("the Auth.js entrypoint", () => {
  beforeEach(() => {
    vi.resetModules();
    NextAuth.mockClear();
    buildAuthConfig.mockClear();
  });

  it("does not build the config when it is imported", async () => {
    await import("@/auth");

    expect(NextAuth).toHaveBeenCalledOnce();
    expect(buildAuthConfig).not.toHaveBeenCalled();
  });

  it("hands Auth.js a factory that builds the config when called", async () => {
    await import("@/auth");
    const factory = NextAuth.mock.calls[0]?.[0];

    expect(factory?.()).toBe(config);
    expect(buildAuthConfig).toHaveBeenCalledOnce();
  });

  it("exports what Auth.js returns", async () => {
    const entry = await import("@/auth");

    expect(entry.handlers).toBe(instance.handlers);
    expect(entry.auth).toBe(instance.auth);
    expect(entry.signIn).toBe(instance.signIn);
    expect(entry.signOut).toBe(instance.signOut);
  });
});
