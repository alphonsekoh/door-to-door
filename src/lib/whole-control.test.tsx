import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { isEntryField, wholeControl } from "@/lib/whole-control";

describe("wholeControl", () => {
  it("is the tile round a checkbox drawn inside its label", () => {
    render(
      <label>
        <input type="checkbox" />
        <span>Blk 123 · #05-123</span>
        <span>Bring the pamphlet</span>
      </label>,
    );
    const box = screen.getByRole("checkbox", { name: /Blk 123/ });
    expect(wholeControl(box)).toBe(box.closest("label"));
  });

  it("is the field itself where its label stands apart", () => {
    render(
      <>
        <label htmlFor="reason">Why</label>
        <input id="reason" />
      </>,
    );
    const field = screen.getByRole("textbox", { name: "Why" });
    expect(wholeControl(field)).toBe(field);
  });

  it("is the field itself with no label at all", () => {
    const { container } = render(
      <>
        <input aria-label="Search" />
        <input type="hidden" name="token" />
      </>,
    );
    const search = screen.getByRole("textbox", { name: "Search" });
    expect(wholeControl(search)).toBe(search);
    // A hidden input has no labels list at all.
    const hidden = container.querySelector('input[type="hidden"]');
    expect(hidden).not.toBeNull();
    if (hidden !== null) expect(wholeControl(hidden)).toBe(hidden);
  });

  it("is anything that is not an input", () => {
    render(
      <>
        <button type="button">Got it</button>
        <label>
          Notes
          <textarea />
        </label>
      </>,
    );
    const button = screen.getByRole("button", { name: "Got it" });
    expect(wholeControl(button)).toBe(button);
    // A field of its own, too tall to be a tile: the field is what is typed in.
    const notes = screen.getByRole("textbox", { name: "Notes" });
    expect(wholeControl(notes)).toBe(notes);
  });
});

describe("isEntryField", () => {
  it("is a field typed or picked in", () => {
    render(
      <>
        <input aria-label="Name" />
        <input type="tel" aria-label="Contact" />
        <textarea aria-label="Notes" />
        <select aria-label="Religion">
          <option>Not known</option>
        </select>
      </>,
    );
    expect(isEntryField(screen.getByRole("textbox", { name: "Name" }))).toBe(true);
    expect(isEntryField(screen.getByRole("textbox", { name: "Contact" }))).toBe(true);
    expect(isEntryField(screen.getByRole("textbox", { name: "Notes" }))).toBe(true);
    expect(isEntryField(screen.getByRole("combobox", { name: "Religion" }))).toBe(true);
  });

  it("is never a tile, a button or anything else, where the thumb already is", () => {
    render(
      <>
        <input type="radio" aria-label="High" />
        <input type="checkbox" aria-label="Blk 123" />
        <button type="button">Save and next</button>
        <p>Saved #05-123.</p>
      </>,
    );
    expect(isEntryField(screen.getByRole("radio", { name: "High" }))).toBe(false);
    expect(isEntryField(screen.getByRole("checkbox", { name: "Blk 123" }))).toBe(false);
    expect(isEntryField(screen.getByRole("button", { name: "Save and next" }))).toBe(false);
    expect(isEntryField(screen.getByText("Saved #05-123."))).toBe(false);
    expect(isEntryField(null)).toBe(false);
  });
});
