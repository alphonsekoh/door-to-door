import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PwaProvider } from "@/components/pwa/pwa-provider";

const { received } = vi.hoisted((): { received: { props: unknown } } => ({
  received: { props: undefined },
}));
vi.mock("@serwist/turbopack/react", () => ({
  SerwistProvider: (props: { children: React.ReactNode }) => {
    received.props = props;
    return <>{props.children}</>;
  },
}));

describe("PwaProvider", () => {
  it("registers /serwist/sw.js without caching pages or reloading under the member", () => {
    render(
      <PwaProvider>
        <p>app</p>
      </PwaProvider>,
    );
    expect(screen.getByText("app")).toBeInTheDocument();
    expect(received.props).toMatchObject({
      swUrl: "/serwist/sw.js",
      cacheOnNavigation: false,
      reloadOnOnline: false,
      options: { scope: "/" },
      // Tests run outside production, where the worker must stay off.
      disable: true,
    });
  });
});
