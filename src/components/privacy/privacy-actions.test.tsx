import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContactLine } from "@/components/privacy/contact-line";
import { PrivacyActions } from "@/components/privacy/privacy-actions";
import type { Household } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

const { useRole } = vi.hoisted(() => ({ useRole: vi.fn() }));
vi.mock("@/lib/hooks/use-role", () => ({ useRole }));

const household = (over: Partial<Household> = {}): Household => ({
  id: "h1",
  blockId: "b1",
  unitNumber: "#05-123",
  name: "Mr Tan",
  contact: "+65 9000 0000",
  religion: null,
  contactWithdrawnAt: null,
  createdAt: "2026-03-14T10:00:00.000Z",
  updatedAt: "2026-03-14T10:00:00.000Z",
  ...over,
});

function show(
  over: Partial<Household> = {},
  { atDoor = false, holdsData = true, onChanged = vi.fn() } = {},
) {
  render(
    <PrivacyActions
      household={household(over)}
      holdsData={holdsData}
      atDoor={atDoor}
      onChanged={onChanged}
    />,
  );
  return onChanged;
}

const member = () => useRole.mockReturnValue({ isAdmin: false });
const admin = () => useRole.mockReturnValue({ isAdmin: true });

beforeEach(() => {
  vi.clearAllMocks();
  member();
  apiFetch.mockResolvedValue({ id: "r1" });
});

describe("what a unit offers when its people ask (#279)", () => {
  it("offers nothing when the unit holds nothing", () => {
    show({}, { holdsData: false });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lets a member pass on a request, never erase", () => {
    show();
    expect(
      screen.getByRole("button", { name: "They asked us to delete their data" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /Erase this unit/ })).toBeNull();
  });

  it("lets an admin erase on the unit's page", () => {
    admin();
    show();
    expect(screen.getByRole("button", { name: "Erase this unit's data…" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "They asked us to delete their data" })).toBeNull();
  });

  it("makes an admin at the door pass it on like a member", () => {
    admin();
    show({}, { atDoor: true });
    expect(
      screen.getByRole("button", { name: "They asked us to delete their data" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /Erase this unit/ })).toBeNull();
  });
});

describe("passing on a request", () => {
  it("logs it for today, thanks the member, and re-reads the unit", async () => {
    const user = userEvent.setup();
    const onChanged = show();
    await user.click(screen.getByRole("button", { name: "They asked us to delete their data" }));
    await user.click(screen.getByRole("button", { name: "Pass it on" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/erasure-requests",
        expect.objectContaining({ method: "POST" }),
      );
    });
    // Today is sent as nothing: the server's clock says when.
    const body = JSON.parse((apiFetch.mock.calls[0]?.[1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body).toEqual({ kind: "household", id: "h1" });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Passed on. An admin will erase it.",
    );
    expect(onChanged).toHaveBeenCalledOnce();
    expect(apiFetch).toHaveBeenCalledOnce();
  });

  it("sends an earlier day as given", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "They asked us to delete their data" }));
    const day = screen.getByLabelText("When they asked");
    await user.clear(day);
    await user.type(day, "2026-03-01");
    await user.click(screen.getByRole("button", { name: "Pass it on" }));

    const body = JSON.parse((apiFetch.mock.calls[0]?.[1] as RequestInit).body as string) as {
      requestedAt: string;
    };
    expect(new Date(body.requestedAt).getTime()).toBe(new Date(2026, 2, 1, 12).getTime());
  });

  it("asks for the day when the field is empty, and sends nothing", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "They asked us to delete their data" }));
    await user.clear(screen.getByLabelText("When they asked"));
    await user.click(screen.getByRole("button", { name: "Pass it on" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose the day they asked.");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("says why when it is refused, and keeps the sheet to try again", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValue(
      new ApiRequestError(409, {
        error: { code: "household_erased", message: "Nothing is held to erase." },
      }),
    );
    const onChanged = show();
    await user.click(screen.getByRole("button", { name: "They asked us to delete their data" }));
    await user.click(screen.getByRole("button", { name: "Pass it on" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing is held to erase.");
    expect(screen.getByRole("button", { name: "Pass it on" })).toBeEnabled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("says to check the connection when no answer came, never the browser's words", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    show();
    await user.click(screen.getByRole("button", { name: "They asked us to delete their data" }));
    await user.click(screen.getByRole("button", { name: "Pass it on" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not send that. Check your connection and try again.",
    );
  });

  it("sends one request for two taps in one frame", async () => {
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => undefined;
    apiFetch.mockReturnValue(new Promise((resolve) => (release = resolve)));
    show();
    await user.click(screen.getByRole("button", { name: "They asked us to delete their data" }));
    const send = screen.getByRole("button", { name: "Pass it on" });
    // Before React has drawn the busy state, the button is still enabled.
    act(() => {
      send.click();
      send.click();
    });
    expect(apiFetch).toHaveBeenCalledOnce();
    release({ id: "r1" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("names the unit in the sheet when the household has no name", async () => {
    const user = userEvent.setup();
    show({ name: null });
    await user.click(screen.getByRole("button", { name: "They asked us to delete their data" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Pass on a deletion request, #05-123");
  });

  it("closes without sending anything", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "They asked us to delete their data" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("erasing the unit, as an admin", () => {
  it("says what goes, reminds of CSV exports, then logs and carries it out", async () => {
    const user = userEvent.setup();
    admin();
    const onChanged = show();
    await user.click(screen.getByRole("button", { name: "Erase this unit's data…" }));

    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveTextContent("every visit and its notes");
    expect(sheet).toHaveTextContent("It cannot be undone.");
    expect(sheet).toHaveTextContent(
      "Also delete any CSV export of All records that holds this unit",
    );

    await user.click(screen.getByRole("button", { name: "Erase" }));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/erasure-requests/r1/erase",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(apiFetch.mock.calls.map((call) => call[0] as string)).toEqual([
      "/erasure-requests",
      "/erasure-requests/r1/erase",
    ]);
    expect(await screen.findByRole("status")).toHaveTextContent("Erased.");
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("keeps its notice when the unit's data is gone, without offering anything more", async () => {
    const user = userEvent.setup();
    admin();
    const view = render(
      <PrivacyActions household={household()} holdsData atDoor={false} onChanged={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Erase this unit's data…" }));
    await user.click(screen.getByRole("button", { name: "Erase" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Erased.");
    view.rerender(
      <PrivacyActions
        household={household()}
        holdsData={false}
        atDoor={false}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Erased.");
    expect(screen.queryByRole("button", { name: /Erase this unit/ })).toBeNull();
  });

  it("leaves the request open for an admin to finish when the erasure itself fails", async () => {
    const user = userEvent.setup();
    admin();
    apiFetch
      .mockResolvedValueOnce({ id: "r1" })
      .mockRejectedValueOnce(
        new ApiRequestError(409, { error: { code: "conflict", message: "Already carried out." } }),
      );
    const onChanged = show();
    await user.click(screen.getByRole("button", { name: "Erase this unit's data…" }));
    await user.click(screen.getByRole("button", { name: "Erase" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Already carried out.");
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("a withdrawn agreement to calls or messages", () => {
  it("is marked by anyone while a contact is recorded", async () => {
    const user = userEvent.setup();
    const onChanged = show();
    await user.click(
      screen.getByRole("button", { name: "Withdrew agreement to calls or messages" }),
    );
    expect(apiFetch).toHaveBeenCalledWith(
      "/households/h1/contact-withdrawal",
      expect.objectContaining({ method: "POST" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Marked. The team will not call or message them.",
    );
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("is not offered with no contact, or once marked", () => {
    show({ contact: null });
    expect(screen.queryByRole("button", { name: /Withdrew agreement/ })).toBeNull();
  });

  it("is not offered again once marked, and a member cannot allow it again", () => {
    show({ contactWithdrawnAt: "2026-03-15T10:00:00.000Z" });
    expect(screen.queryByRole("button", { name: /Withdrew agreement/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Allow calls/ })).toBeNull();
  });

  it("is allowed again by an admin alone", async () => {
    const user = userEvent.setup();
    admin();
    const onChanged = show({ contactWithdrawnAt: "2026-03-15T10:00:00.000Z" });
    await user.click(screen.getByRole("button", { name: "Allow calls or messages again" }));
    expect(apiFetch).toHaveBeenCalledWith(
      "/households/h1/contact-withdrawal",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "They can be called or messaged again.",
    );
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("says why a failure happened and clears it on the next try", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValueOnce(
      new ApiRequestError(409, { error: { code: "conflict", message: "No contact is recorded." } }),
    );
    show();
    const mark = screen.getByRole("button", { name: "Withdrew agreement to calls or messages" });
    await user.click(mark);
    expect(await screen.findByRole("alert")).toHaveTextContent("No contact is recorded.");

    apiFetch.mockResolvedValueOnce({});
    await user.click(mark);
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  it("says to check the connection when no answer came", async () => {
    const user = userEvent.setup();
    apiFetch.mockRejectedValueOnce(new TypeError("Load failed"));
    show();
    await user.click(
      screen.getByRole("button", { name: "Withdrew agreement to calls or messages" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save that. Check your connection and try again.",
    );
  });
});

describe("ContactLine", () => {
  it("shows the contact, and badges one that was withdrawn", () => {
    const { rerender } = render(<ContactLine household={household()} />);
    expect(screen.getByText("+65 9000 0000")).toBeVisible();
    expect(screen.queryByText("No calls or messages")).toBeNull();

    rerender(
      <ContactLine household={household({ contactWithdrawnAt: "2026-03-15T10:00:00.000Z" })} />,
    );
    expect(screen.getByText("No calls or messages")).toBeVisible();
  });

  it("shows nothing for a unit with no contact", () => {
    const { container } = render(<ContactLine household={household({ contact: null })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not badge a copy of the unit from before the field existed", () => {
    const { contactWithdrawnAt: _gone, ...older } = household();
    render(<ContactLine household={older} />);
    expect(screen.queryByText("No calls or messages")).toBeNull();
  });
});
