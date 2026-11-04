import { act, render, screen } from "@testing-library/react";
import { type UpdateSession, useSession } from "next-auth/react";
import { Suspense, lazy } from "react";
import { type Root, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeferredSessionProvider } from "@/components/shell/deferred-session-provider";

const SIGNED_IN = {
  user: { id: "member-1", name: "Ann Lee", email: "ann@example.com" },
  expires: "2099-01-01T00:00:00.000Z",
};

/* The answer to Auth.js's GET /api/auth/session, held until a test gives it. */
let answer: (session: unknown) => void = () => undefined;
const fetchSession = vi.fn<(url: string) => Promise<Response>>();

beforeEach(() => {
  fetchSession.mockReset();
  fetchSession.mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = (session) => {
          resolve(Response.json(session));
        };
      }),
  );
  vi.stubGlobal("fetch", fetchSession);
  /* Auth.js opens a channel per fetch and never closes it. */
  vi.stubGlobal("BroadcastChannel", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function Status() {
  const { status, data } = useSession();
  return (
    <p>
      {status} {data?.user.name ?? "nobody"}
    </p>
  );
}

function Screen() {
  return <input aria-label="Unit number" />;
}

/* The screen sits in the shell's main, as in the app: the change reaches a
   screen still waiting for its script through what lies between. */
function Page({ screen }: { screen: React.ReactNode }) {
  return (
    <DeferredSessionProvider>
      <Status />
      <main>
        <Suspense fallback={<p>Loading the block…</p>}>{screen}</Suspense>
      </main>
    </DeferredSessionProvider>
  );
}

describe("DeferredSessionProvider", () => {
  it("hands the app Auth.js's session once the server has answered", async () => {
    render(
      <DeferredSessionProvider>
        <Status />
      </DeferredSessionProvider>,
    );
    expect(screen.getByText("loading nobody")).toBeInTheDocument();
    expect(fetchSession).toHaveBeenCalledExactlyOnceWith("/api/auth/session", expect.anything());

    await act(async () => {
      answer(SIGNED_IN);
      await Promise.resolve();
    });
    expect(await screen.findByText("authenticated Ann Lee")).toBeInTheDocument();
  });

  it("hands on a refused session as signed out", async () => {
    render(
      <DeferredSessionProvider>
        <Status />
      </DeferredSessionProvider>,
    );
    await act(async () => {
      answer(null);
      await Promise.resolve();
    });
    expect(await screen.findByText("unauthenticated nobody")).toBeInTheDocument();
  });

  it("sends nothing for an update asked before the server has answered", async () => {
    const seen: UpdateSession[] = [];
    function Updater() {
      seen.push(useSession().update);
      return null;
    }
    render(
      <DeferredSessionProvider>
        <Updater />
      </DeferredSessionProvider>,
    );
    const first = seen[0];
    if (first === undefined) throw new Error("the app never rendered");

    await expect(first({ name: "Ann" })).resolves.toBeNull();
    expect(fetchSession).toHaveBeenCalledTimes(1);
  });

  /* #113: the shell's script has arrived and the screen's has not, so
     React leaves the screen as the server's HTML, which the member types
     into. The session answers first. */
  describe("with a screen still waiting for its script", () => {
    let container: HTMLDivElement;
    let root: Root | undefined;
    let arrive: () => void = () => undefined;

    beforeEach(async () => {
      container = document.createElement("div");
      container.innerHTML = renderToString(<Page screen={<Screen />} />);
      document.body.append(container);

      const late = new Promise<{ default: typeof Screen }>((resolve) => {
        arrive = () => {
          resolve({ default: Screen });
        };
      });
      const LateScreen = lazy(() => late);
      await act(async () => {
        root = hydrateRoot(container, <Page screen={<LateScreen />} />);
        await Promise.resolve();
      });
    });

    afterEach(() => {
      act(() => {
        root?.unmount();
      });
      container.remove();
    });

    function unitField(): HTMLInputElement {
      const field = container.querySelector("input");
      if (field === null) throw new Error("the screen's field is gone");
      return field;
    }

    it("keeps the screen's HTML, and what was typed, until it is live", async () => {
      const field = unitField();
      field.value = "#24-01";

      await act(async () => {
        answer(SIGNED_IN);
        await Promise.resolve();
      });
      expect(container).not.toHaveTextContent("Loading the block…");
      expect(unitField()).toBe(field);
      expect(field).toHaveValue("#24-01");

      await act(async () => {
        arrive();
        await Promise.resolve();
      });
      expect(unitField()).toBe(field);
      expect(field).toHaveValue("#24-01");
      expect(container).toHaveTextContent("authenticated Ann Lee");
    });
  });
});
