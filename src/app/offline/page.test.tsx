import "fake-indexeddb/auto";
import { render, screen } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SignedInModule from "@/lib/sync/signed-in";
import OfflinePage from "@/app/offline/page";
import { updateLocalCopy } from "@/lib/offline/local-copy-store";

vi.mock("next/navigation", () => ({
  usePathname: () => "/offline",
  useSelectedLayoutSegment: () => "offline",
}));
vi.mock("@/lib/sync/signed-in", async (importOriginal) => ({
  ...(await importOriginal<typeof SignedInModule>()),
  fetchSignedIn: () => Promise.resolve({ kind: "unknown" }),
}));

const ALICE = "0190a000-0000-7000-8000-00000000000a";

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the offline page", () => {
  it("is headed Offline, and opens the shell", async () => {
    render(<OfflinePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Offline" })).toBeInTheDocument();
    expect(screen.getByText("Offline. Records save on this phone.")).toBeInTheDocument();
    // Nothing on this phone: the shell says so (its own tests cover the rest).
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  /* The service worker precaches this HTML and serves it to whoever holds
     the phone, so it must be the same for everyone (D-32-4, D-77-7). */
  it("renders on the server with nothing but fixed text, whatever is saved on the phone", async () => {
    await updateLocalCopy(() => ({
      v: 3,
      member: { id: ALICE, name: "Alice Tan" },
      savedAt: Date.now(),
      outing: null,
      blocks: [],
      revisits: null,
      threads: [],
    }));
    const html = renderToString(<OfflinePage />);
    const text = html
      .replace(/<[^>]+>/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    expect(text).toEqual([
      "Offline",
      "Offline. Records save on this phone.",
      "Looking for what is saved on this phone…",
    ]);
  });
});
