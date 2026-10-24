import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateSessionForm } from "@/components/sessions/create-session-form";
import type { FollowUp } from "@/generated/types.gen";
import { ApiRequestError } from "@/lib/api-client";
import type * as ApiClientModule from "@/lib/api-client";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof ApiClientModule>("@/lib/api-client");
  return { ...actual, apiFetch };
});

function listed(
  householdId: string,
  blockName: string,
  unitNumber: string,
  note: string,
): FollowUp {
  return {
    id: `${householdId}-${note}`,
    householdId,
    blockId: `b-${blockName}`,
    blockName,
    unitNumber,
    visitId: null,
    status: "listed",
    author: { id: "a1", name: "Admin", image: null },
    note,
    dueDate: null,
    doneAt: null,
    doneBy: null,
    listedAt: null,
    listedBy: null,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    waitingSuggestionBy: null,
    createdAt: "2026-10-01T00:00:00.000Z",
  };
}

/* Three households on the list: two in Blk 123 (one with two notes), one in Blk 125. */
const LIST = [
  listed("h2", "125", "#01-01", "Ask about Sunday"),
  listed("h1", "123", "#05-123", "Bring the flyer"),
  listed("h1", "123", "#05-123", "Ask for the father"),
  listed("h3", "123", "#02-201", "Call after 7pm"),
];

const page = (data: FollowUp[]) => ({
  data,
  pagination: { limit: 100, offset: 0, total: data.length, hasMore: false },
});

/* The follow-up list, read when the form opens, and what a create answers. */
function server({
  list = () => Promise.resolve(page(LIST)),
  create = () => Promise.resolve({ id: "s1", status: "draft" }),
}: {
  list?: () => Promise<unknown>;
  create?: () => Promise<unknown>;
} = {}) {
  apiFetch.mockImplementation((path: string) =>
    path.startsWith("/follow-ups") ? list() : create(),
  );
}

const creates = () =>
  apiFetch.mock.calls
    .filter(([path]) => path === "/sessions")
    .map(([, init]) => JSON.parse((init as { body: string }).body) as unknown);

async function open(onCreated = vi.fn()) {
  const user = userEvent.setup();
  render(<CreateSessionForm onCreated={onCreated} />);
  await user.click(screen.getByRole("button", { name: "New session" }));
  return user;
}

async function followUp(onCreated = vi.fn()) {
  const user = await open(onCreated);
  await user.click(screen.getByRole("radio", { name: /Follow-up/ }));
  await user.type(screen.getByLabelText("Name this session"), "Revisits");
  return user;
}

const create = () => screen.getByRole("button", { name: "Create draft" });
const picker = () => within(screen.getByRole("group", { name: "Households to visit" }));

beforeEach(() => {
  vi.clearAllMocks();
  server();
});

describe("CreateSessionForm", () => {
  it("stays out of the way until asked for", () => {
    render(<CreateSessionForm onCreated={vi.fn()} />);
    expect(screen.queryByLabelText("Name this session")).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("creates a draft, not a running outing", async () => {
    const onCreated = vi.fn();
    const user = await open(onCreated);
    await user.type(screen.getByLabelText("Name this session"), "Saturday morning");
    await user.click(create());

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
    expect(creates()).toEqual([{ title: "Saturday morning", kind: "regular" }]);
  });

  it("asks what kind of session it is, door-to-door unless chosen otherwise", async () => {
    await open();
    const kinds = screen.getByRole("group", { name: "What kind of session?" });
    expect(screen.getByRole("radio", { name: /Door-to-door/ })).toBeChecked();
    expect(kinds).toHaveTextContent("Knock on every unit in the blocks you attach.");
    expect(kinds).toHaveTextContent(
      "Go back to households you pick from the follow-up list. Members can record only those households.",
    );
    expect(kinds).toHaveTextContent("You can't change this later.");
  });

  it("refuses an outing with no name, before a round trip", async () => {
    const user = await open();
    await user.click(create());
    expect(await screen.findByRole("alert")).toHaveTextContent("Give the session a name.");
    expect(creates()).toEqual([]);
  });

  it("treats whitespace as no name", async () => {
    const user = await open();
    await user.type(screen.getByLabelText("Name this session"), "   ");
    await user.click(create());
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(creates()).toEqual([]);
  });

  it("keeps what was typed when the server refuses", async () => {
    server({ create: () => Promise.reject(new Error("A session with that name already exists.")) });
    const user = await open();
    await user.type(screen.getByLabelText("Name this session"), "Saturday morning");
    await user.click(create());
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
    expect(screen.getByLabelText("Name this session")).toHaveValue("Saturday morning");
  });

  it("copes with a non-Error failure", async () => {
    const user = await open();
    await user.type(screen.getByLabelText("Name this session"), "Saturday");
    // The list was read on opening; the next request is the create.
    apiFetch.mockRejectedValueOnce("boom");
    await user.click(create());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not create the session.");
  });

  it("folds away again on cancel", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "New session" })).toBeInTheDocument();
  });
});

describe("creating a follow-up session", () => {
  it("ticks everything on the follow-up list, grouped by block, and sends it", async () => {
    const onCreated = vi.fn();
    const user = await followUp(onCreated);
    expect(screen.getByLabelText("Name this session")).toHaveAttribute(
      "placeholder",
      "Follow-up visits, Saturday",
    );
    const group = picker();
    expect(
      group.getByText(
        "Everything on the follow-up list is ticked. Untick any you won't visit in this session.",
      ),
    ).toBeVisible();
    expect(group.getByRole("status")).toHaveTextContent("3 of 3 households ticked");
    const boxes = group.getAllByRole("checkbox");
    expect(boxes.map((box) => box.getAttribute("aria-label"))).toEqual([
      "Blk 123 · #02-201",
      "Blk 123 · #05-123",
      "Blk 125 · #01-01",
    ]);
    expect(boxes.every((box) => (box as HTMLInputElement).checked)).toBe(true);
    // The first note says what the visit is for; the rest are counted.
    expect(group.getByRole("checkbox", { name: "Blk 123 · #05-123" })).toHaveAccessibleDescription(
      "Bring the flyer",
    );
    expect(group.getByText("+1 more")).toBeVisible();

    await user.click(create());
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
    expect(creates()).toEqual([
      { title: "Revisits", kind: "follow_up", householdIds: ["h3", "h1", "h2"] },
    ]);
  });

  it("leaves out the households unticked", async () => {
    const user = await followUp();
    await user.click(picker().getByRole("checkbox", { name: "Blk 125 · #01-01" }));
    expect(picker().getByRole("status")).toHaveTextContent("2 of 3 households ticked");
    await user.click(create());
    await waitFor(() => {
      expect(creates()).toEqual([
        { title: "Revisits", kind: "follow_up", householdIds: ["h3", "h1"] },
      ]);
    });
  });

  it("needs at least one household, and says so beside Create draft", async () => {
    const user = await followUp();
    await user.click(picker().getByRole("button", { name: "Untick all" }));
    expect(picker().getByRole("status")).toHaveTextContent("0 of 3 households ticked");
    expect(create()).toBeDisabled();
    expect(create()).toHaveAccessibleDescription("Tick at least one household to visit.");

    await user.click(picker().getByRole("button", { name: "Tick all" }));
    expect(create()).toBeEnabled();
    expect(create()).not.toHaveAccessibleDescription();
  });

  it("waits for the follow-up list before it can be created", async () => {
    server({ list: () => new Promise(() => undefined) });
    await followUp();
    expect(create()).toBeDisabled();
    expect(create()).toHaveAccessibleDescription("Loading the follow-up list…");
    expect(screen.queryByRole("group", { name: "Households to visit" })).toBeNull();
  });

  it("says when the follow-up list cannot be read, and reads it again on request", async () => {
    let fail = true;
    server({
      list: () => (fail ? Promise.reject(new TypeError("offline")) : Promise.resolve(page(LIST))),
    });
    const user = await followUp();
    expect(create()).toHaveAccessibleDescription("Could not load the follow-up list.");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("group", { name: "Households to visit" })).toBeVisible();
    expect(create()).toBeEnabled();
  });

  it("sends the admin to the follow-up list when it is empty", async () => {
    server({ list: () => Promise.resolve(page([])) });
    const user = await open();
    const kinds = within(screen.getByRole("group", { name: "What kind of session?" }));
    expect(await kinds.findByText("Add households to the follow-up list first.")).toBeVisible();
    expect(kinds.getByRole("link", { name: "Open the follow-up list" })).toHaveAttribute(
      "href",
      "/admin/follow-ups",
    );

    await user.click(screen.getByRole("radio", { name: /Follow-up/ }));
    await user.type(screen.getByLabelText("Name this session"), "Revisits");
    expect(screen.queryByRole("group", { name: "Households to visit" })).toBeNull();
    expect(create()).toBeDisabled();
    expect(create()).toHaveAccessibleDescription("Add households to the follow-up list first.");

    // A door-to-door session needs nothing from the list.
    await user.click(screen.getByRole("radio", { name: /Door-to-door/ }));
    expect(create()).toBeEnabled();
  });

  it("reads the list again when a household left it, keeping what was unticked", async () => {
    let reads = 0;
    server({
      list: () => {
        reads += 1;
        // #01-01 in Blk 125 was resolved meanwhile; a new door was listed.
        return Promise.resolve(
          page(
            reads === 1
              ? LIST
              : [
                  ...LIST.filter((note) => note.householdId !== "h2"),
                  listed("h4", "130", "#03-03", "New"),
                ],
          ),
        );
      },
      create: () =>
        Promise.reject(
          new ApiRequestError(409, {
            error: {
              code: "not_on_follow_up_list",
              message:
                "A household you picked is no longer on the follow-up list. Refresh the list and pick again.",
            },
          }),
        ),
    });
    const user = await followUp();
    await user.click(picker().getByRole("checkbox", { name: "Blk 123 · #02-201" }));
    await user.click(create());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A household you picked is no longer on the follow-up list. Refresh the list and pick again.",
    );
    await waitFor(() => {
      expect(picker().getByRole("status")).toHaveTextContent("2 of 3 households ticked");
    });
    expect(picker().getByRole("checkbox", { name: "Blk 123 · #02-201" })).not.toBeChecked();
    expect(picker().getByRole("checkbox", { name: "Blk 130 · #03-03" })).toBeChecked();
    expect(picker().queryByRole("checkbox", { name: "Blk 125 · #01-01" })).toBeNull();
  });

  it("starts the next session as door-to-door again", async () => {
    const user = await followUp();
    await user.click(create());
    await user.click(await screen.findByRole("button", { name: "New session" }));
    expect(screen.getByRole("radio", { name: /Door-to-door/ })).toBeChecked();
  });
});
