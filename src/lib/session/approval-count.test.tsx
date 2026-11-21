import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const total = (count: number) => ({
  data: [],
  pagination: { limit: 1, offset: 0, total: count, hasMore: count > 1 },
});

/* The store is a module singleton read once per load: each test loads afresh. */
async function fresh() {
  vi.resetModules();
  return import("@/lib/session/approval-count");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the approval count (#249)", () => {
  it("is read once per page load, one row asked for, however often it is asked", async () => {
    const { createApprovalCountStore } = await fresh();
    apiFetch.mockResolvedValue(total(3));
    const store = createApprovalCountStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.load();
    store.load();
    await vi.waitFor(() => {
      expect(store.getSnapshot()).toBe(3);
    });
    expect(apiFetch).toHaveBeenCalledOnce();
    expect(apiFetch).toHaveBeenCalledWith("/users?approval=pending&limit=1");
    expect(listener).toHaveBeenCalledOnce();
    expect(store.getServerSnapshot()).toBeNull();
  });

  it("stays unknown when the read fails, offline or refused", async () => {
    const { createApprovalCountStore } = await fresh();
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const store = createApprovalCountStore();
    store.load();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getSnapshot()).toBeNull();
  });

  it("takes Team's count after a change, and a read it overtook cannot put the old one back", async () => {
    const { createApprovalCountStore } = await fresh();
    let answer: (value: unknown) => void = () => undefined;
    apiFetch.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const store = createApprovalCountStore();
    store.load();
    store.set(1);
    expect(store.getSnapshot()).toBe(1);

    answer(total(2));
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getSnapshot()).toBe(1);
  });

  it("stops telling a listener once it unsubscribes", async () => {
    const { createApprovalCountStore } = await fresh();
    const store = createApprovalCountStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set(4);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("useApprovalCount", () => {
  it("asks only once enabled, and draws the count when it comes", async () => {
    const { approvalCount, useApprovalCount } = await fresh();
    function Count({ enabled }: { enabled: boolean }) {
      return <p>{String(useApprovalCount(enabled))}</p>;
    }
    apiFetch.mockResolvedValue(total(5));

    const { rerender } = render(<Count enabled={false} />);
    expect(screen.getByText("null")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();

    rerender(<Count enabled />);
    expect(await screen.findByText("5")).toBeInTheDocument();

    act(() => {
      approvalCount.set(0);
    });
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});

describe("badgeCount", () => {
  it("shows the number up to 99, and 99+ past it", async () => {
    const { badgeCount } = await fresh();
    expect(badgeCount(1)).toBe("1");
    expect(badgeCount(99)).toBe("99");
    expect(badgeCount(100)).toBe("99+");
  });
});
