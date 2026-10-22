import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VisitByline } from "@/components/visits/visit-byline";

const person = (id: string, name: string | null) => ({ id, name, image: null });
const teamed = {
  member: person("a", "Alice Tan"),
  team: { id: "t1", name: "North pair", members: [person("b", "Ben Lim")] },
};

describe("VisitByline", () => {
  it("names the author, the teammates and the team in words", () => {
    render(<VisitByline visit={teamed} prefix="By " />);
    expect(screen.getByText("By Alice Tan with Ben Lim")).toBeInTheDocument();
    expect(screen.getByText("Team: North pair")).toBeInTheDocument();
  });

  it("can leave the team chip out where space is tight", () => {
    render(<VisitByline visit={teamed} withTeam={false} />);
    expect(screen.getByText("Alice Tan with Ben Lim")).toBeInTheDocument();
    expect(screen.queryByText(/Team:/)).not.toBeInTheDocument();
  });

  it("shows no chip for a record made without a team", () => {
    render(<VisitByline visit={{ member: person("a", null), team: null }} />);
    expect(screen.getByText("Someone")).toBeInTheDocument();
    expect(screen.queryByText(/Team:/)).not.toBeInTheDocument();
  });

  it("wraps long names instead of cutting them off", () => {
    const long = "Alexandra Wilhelmina Tan-Rodriguez Fitzgerald";
    render(<VisitByline visit={{ ...teamed, member: person("a", long) }} />);
    const line = screen.getByText(`${long} with Ben Lim`);
    expect(line.className).toContain("break-words");
    expect(line.className).not.toContain("truncate");
  });
});
