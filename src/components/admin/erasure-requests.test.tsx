import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErasureRequests } from "@/components/admin/erasure-requests";
import type { ErasureRequest, ErasureRequestList, RetentionRun } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";
import { eraseBy } from "@/lib/privacy/due";
import { formatDay } from "@/lib/history/dates";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const AT = "2026-03-14T11:00:00.000Z";
const person = (id: string, name: string | null) => ({ id, name, image: null });

const unit = (
  id: string,
  unitNumber: string,
  over: Partial<ErasureRequest> = {},
): ErasureRequest => ({
  id,
  kind: "household",
  household: {
    id: `h-${id}`,
    blockId: "b1",
    unitNumber,
    name: "Mr Tan",
    contact: null,
    religion: null,
    createdAt: AT,
    updatedAt: AT,
  },
  block: { id: "b1", name: "Blk 123", street: "Test Ave", postalCode: null, createdAt: AT },
  account: null,
  requestedAt: new Date().toISOString(),
  loggedBy: person("u1", "Alice"),
  loggedAt: AT,
  erasedAt: null,
  erasedBy: null,
  ...over,
});

const account = (id: string, name: string | null, over: Partial<ErasureRequest> = {}) =>
  unit(id, "x", {
    kind: "account",
    household: null,
    block: null,
    account: person("u9", name),
    ...over,
  });

const RUN: RetentionRun = {
  ranAt: "2026-11-25T18:00:00.000Z",
  households: 1,
  accounts: 2,
  signIns: 0,
  more: false,
};

const list = (
  data: ErasureRequest[],
  over: Partial<ErasureRequestList> = {},
): ErasureRequestList => ({
  data,
  pagination: { limit: 50, offset: 0, total: data.length, hasMore: false },
  lastRetentionRun: RUN,
  ...over,
});

function serve(open: ErasureRequestList, erased: ErasureRequestList = list([])) {
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    if (init?.method === "POST") return Promise.resolve({});
    return Promise.resolve(path.includes("status=erased") ? erased : open);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Erasure requests (#279)", () => {
  it("lists what waits, with who passed it on and when it must be done by", async () => {
    const asked = "2026-11-02T04:00:00.000Z";
    serve(list([unit("r1", "#05-123", { requestedAt: asked })]));
    render(<ErasureRequests />);

    const row = (await screen.findByText("#05-123")).closest("li") as HTMLElement;
    expect(row).toHaveTextContent("Blk 123");
    expect(row).toHaveTextContent(`Asked ${formatDay(asked)} · passed on by Alice`);
    expect(row).toHaveTextContent(`Erase by ${formatDay(eraseBy(asked))} (overdue)`);
    expect(row.querySelector(".text-danger")).not.toBeNull();
    expect(apiFetch).toHaveBeenCalledWith("/erasure-requests?status=open&limit=50");
  });

  it("does not call a request overdue before its day", async () => {
    serve(list([unit("r1", "#05-123")]));
    render(<ErasureRequests />);
    const row = (await screen.findByText("#05-123")).closest("li") as HTMLElement;
    expect(row).not.toHaveTextContent("(overdue)");
    expect(row.querySelector(".text-danger")).toBeNull();
  });

  it("names an account request by the member, 'Someone' when they have no name", async () => {
    serve(list([account("r1", "Ben"), account("r2", null)]));
    render(<ErasureRequests />);
    expect(await screen.findByText("Account: Ben")).toBeVisible();
    expect(screen.getByText("Account: Someone")).toBeVisible();
    expect(screen.getByRole("button", { name: "Erase the account of Ben" })).toBeVisible();
  });

  it("says nothing waits, and nothing was erased on request", async () => {
    serve(list([]));
    render(<ErasureRequests />);
    expect(await screen.findByText("No requests are waiting.")).toBeVisible();

    await userEvent.setup().click(screen.getByRole("tab", { name: "Erased" }));
    expect(await screen.findByText("Nothing has been erased on request.")).toBeVisible();
  });

  it("shows the erased ones for the record, by whom, with nothing left to press", async () => {
    serve(
      list([]),
      list([
        unit("r1", "#05-123", { erasedAt: AT, erasedBy: person("a1", "Admin") }),
        account("r2", null, { erasedAt: AT, erasedBy: null }),
      ]),
    );
    render(<ErasureRequests />);
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Erased" }));

    const row = (await screen.findByText("#05-123")).closest("li") as HTMLElement;
    expect(row).toHaveTextContent(`Erased ${formatDay(AT)} by Admin`);
    expect(screen.getByText("Account: Someone").closest("li")).toHaveTextContent(
      "by the retention job",
    );
    expect(screen.queryByRole("button", { name: /^Erase/ })).toBeNull();
    expect(apiFetch).toHaveBeenCalledWith("/erasure-requests?status=erased&limit=50");
  });

  it("shows only the tab asked for last, though an earlier read answers after it", async () => {
    const user = userEvent.setup();
    let late: (value: unknown) => void = () => undefined;
    apiFetch.mockImplementation((path: string) =>
      path.includes("status=open")
        ? new Promise((resolve) => (late = resolve))
        : Promise.resolve(list([unit("r2", "#09-09", { erasedAt: AT })])),
    );
    render(<ErasureRequests />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });
    await user.click(screen.getByRole("tab", { name: "Erased" }));
    expect(await screen.findByText("#09-09")).toBeVisible();

    late(list([unit("r1", "#01-01")]));
    await Promise.resolve();
    expect(screen.queryByText("#01-01")).toBeNull();
    expect(screen.getByRole("tab", { name: "Erased" })).toHaveAttribute("aria-selected", "true");
  });

  it("does not read again for the tab already open", async () => {
    serve(list([]));
    render(<ErasureRequests />);
    await screen.findByText("No requests are waiting.");
    await userEvent.setup().click(screen.getByRole("tab", { name: "Waiting" }));
    expect(apiFetch).toHaveBeenCalledOnce();
  });

  describe("erasing", () => {
    it("asks first, naming the unit, and then erases and reads again", async () => {
      const user = userEvent.setup();
      serve(list([unit("r1", "#05-123")]));
      render(<ErasureRequests />);
      await user.click(await screen.findByRole("button", { name: "Erase Blk 123 #05-123" }));

      const dialog = screen.getByRole("alertdialog", { name: "Erase Blk 123 #05-123?" });
      expect(dialog).toHaveTextContent("It cannot be undone.");
      expect(dialog).toHaveTextContent("Also delete any CSV export that holds this unit.");
      expect(apiFetch).not.toHaveBeenCalledWith(
        expect.stringContaining("/erase"),
        expect.anything(),
      );

      serve(list([]));
      await user.click(within(dialog).getByRole("button", { name: "Erase" }));
      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith(
          "/erasure-requests/r1/erase",
          expect.objectContaining({ method: "POST" }),
        );
      });
      expect(await screen.findByText("No requests are waiting.")).toBeVisible();
    });

    it("words an account's question for the account", async () => {
      const user = userEvent.setup();
      serve(list([account("r1", "Ben")]));
      render(<ErasureRequests />);
      await user.click(await screen.findByRole("button", { name: "Erase the account of Ben" }));
      expect(screen.getByRole("alertdialog")).toHaveTextContent(
        "Google link, password and sign-ins",
      );
      await user.click(screen.getByRole("button", { name: "Keep as it is" }));
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    it("says why it was refused in that row, and reads again when someone got there first", async () => {
      const user = userEvent.setup();
      serve(list([unit("r1", "#05-123")]));
      render(<ErasureRequests />);
      await user.click(await screen.findByRole("button", { name: "Erase Blk 123 #05-123" }));

      apiFetch.mockImplementation((path: string, init?: RequestInit) =>
        init?.method === "POST"
          ? Promise.reject(
              new ApiRequestError(409, {
                error: { code: "conflict", message: "That request has already been carried out." },
              }),
            )
          : Promise.resolve(list([unit("r1", "#05-123")])),
      );
      await user.click(screen.getByRole("button", { name: "Erase" }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("That request has already been carried out.");
      expect(alert.closest("li")).toHaveTextContent("#05-123");
      // Read again: the list call after the refused POST.
      await waitFor(() => {
        expect(
          apiFetch.mock.calls.filter(([path]) => path === "/erasure-requests?status=open&limit=50"),
        ).toHaveLength(2);
      });
    });

    it("says to try again for a failure that is not a refusal, without reading again", async () => {
      const user = userEvent.setup();
      serve(list([unit("r1", "#05-123")]));
      render(<ErasureRequests />);
      await user.click(await screen.findByRole("button", { name: "Erase Blk 123 #05-123" }));
      apiFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await user.click(screen.getByRole("button", { name: "Erase" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not erase that.");
      expect(apiFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("the list failing", () => {
    it("says so, and tries again", async () => {
      const user = userEvent.setup();
      apiFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      render(<ErasureRequests />);
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the requests.");

      serve(list([]));
      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByText("No requests are waiting.")).toBeVisible();
    });

    it("says the server's sentence for a refusal", async () => {
      apiFetch.mockRejectedValueOnce(
        new ApiRequestError(403, { error: { code: "forbidden", message: "Admins only." } }),
      );
      render(<ErasureRequests />);
      expect(await screen.findByRole("alert")).toHaveTextContent("Admins only.");
    });

    it("drops a failure that an older read lands after a newer answer", async () => {
      const user = userEvent.setup();
      let reject: (error: unknown) => void = () => undefined;
      apiFetch.mockImplementation((path: string) =>
        path.includes("status=open")
          ? new Promise((_resolve, fail) => (reject = fail))
          : Promise.resolve(list([unit("r2", "#09-09", { erasedAt: AT })])),
      );
      render(<ErasureRequests />);
      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledTimes(1);
      });
      await user.click(screen.getByRole("tab", { name: "Erased" }));
      await screen.findByText("#09-09");
      reject(new TypeError("Failed to fetch"));
      await Promise.resolve();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("the footer", () => {
    it("says when retention last ran, and what it did", async () => {
      serve(list([]));
      render(<ErasureRequests />);
      expect(
        await screen.findByText(
          `Retention last ran ${formatDay(RUN.ranAt)}: 1 household, 2 accounts, 0 sign-ins.`,
        ),
      ).toBeVisible();
    });

    it("says one of each without a plural", async () => {
      serve(list([], { lastRetentionRun: { ...RUN, households: 2, accounts: 1, signIns: 1 } }));
      render(<ErasureRequests />);
      expect(await screen.findByText(/2 households, 1 account, 1 sign-in\./)).toBeVisible();
    });

    it("warns when it has never run", async () => {
      serve(list([], { lastRetentionRun: null }));
      render(<ErasureRequests />);
      expect(await screen.findByText(/Retention has never run/)).toBeVisible();
    });

    it("says when only some of a long list is shown", async () => {
      serve(
        list([unit("r1", "#05-123")], {
          pagination: { limit: 50, offset: 0, total: 80, hasMore: true },
        }),
      );
      render(<ErasureRequests />);
      expect(await screen.findByText(/The first 1 of 80 are shown\./)).toBeVisible();
    });
  });
});
