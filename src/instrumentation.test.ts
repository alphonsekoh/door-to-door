import { afterEach, describe, expect, it, vi } from "vitest";

const { verifyConfigOrExit } = vi.hoisted(() => ({ verifyConfigOrExit: vi.fn() }));
vi.mock("@/server/config", () => ({ verifyConfigOrExit }));

import { register } from "@/instrumentation";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("register", () => {
  it("loads the config at server start on the Node runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await register();
    expect(verifyConfigOrExit).toHaveBeenCalledTimes(1);
  });

  it("does not read the file while building", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await register();
    expect(verifyConfigOrExit).not.toHaveBeenCalled();
  });

  it("does nothing on the edge runtime, which has no filesystem", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await register();
    expect(verifyConfigOrExit).not.toHaveBeenCalled();
  });
});
