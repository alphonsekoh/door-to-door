import { describe, expect, it } from "vitest";
import { compareUuids, distinctUuidsInOrder, sameUuid, uuidv7 } from "@/lib/uuid";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("uuidv7", () => {
  it("looks like a uuid", () => {
    expect(uuidv7()).toMatch(UUID);
  });

  it("declares version 7", () => {
    // The contract and the schema both expect v7; v4 would pass a format check
    // but lose the ordering the offline queue depends on.
    expect(uuidv7().split("-")[2]?.[0]).toBe("7");
  });

  it("sets the RFC variant", () => {
    const variant = uuidv7().split("-")[3]?.[0] ?? "";
    expect(["8", "9", "a", "b"]).toContain(variant);
  });

  it("encodes the timestamp in the leading bytes", () => {
    const id = uuidv7(0x0192_3456_789a);
    expect(id.startsWith("01923456-789a")).toBe(true);
  });

  it("sorts by creation time", () => {
    // What v4 cannot do, and why a flushed queue is easy to reason about.
    const earlier = uuidv7(1_700_000_000_000);
    const later = uuidv7(1_700_000_001_000);
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it("differs between calls at the same instant", () => {
    const at = 1_700_000_000_000;
    expect(uuidv7(at)).not.toBe(uuidv7(at));
  });

  it("is unique across many calls", () => {
    const ids = new Set(Array.from({ length: 500 }, () => uuidv7()));
    expect(ids.size).toBe(500);
  });

  it("handles a zero timestamp", () => {
    expect(uuidv7(0)).toMatch(UUID);
    expect(uuidv7(0).startsWith("00000000-0000")).toBe(true);
  });

  it("is deterministic given a fixed clock and source of randomness", () => {
    const fixed = () => 0.5;
    expect(uuidv7(1_700_000_000_000, fixed)).toBe(uuidv7(1_700_000_000_000, fixed));
  });
});

describe("sameUuid", () => {
  it("matches an id in either case, and only that id", () => {
    const id = "5191d000-0000-4000-8000-00000000000a";
    expect(sameUuid(id, id.toUpperCase())).toBe(true);
    expect(sameUuid(id, "5191d000-0000-4000-8000-00000000000b")).toBe(false);
  });
});

describe("compareUuids", () => {
  it("orders ids as Postgres does, whatever their case", () => {
    // Plain string order puts "B" before "a"; Postgres compares the bytes, 0x0a < 0x0b.
    const lower = "0a000000-0000-4000-8000-000000000000";
    const upper = "0B000000-0000-4000-8000-000000000000";
    expect([upper, lower].sort()).toEqual([upper, lower]);
    expect([upper, lower].sort(compareUuids)).toEqual([lower, upper]);
    expect(compareUuids(lower, upper)).toBe(-1);
    expect(compareUuids(upper, lower)).toBe(1);
  });

  it("calls one id in either case equal", () => {
    const id = "5191d000-0000-4000-8000-00000000000a";
    expect(compareUuids(id, id.toUpperCase())).toBe(0);
  });
});

describe("distinctUuidsInOrder", () => {
  it("keeps one id sent in two cases once, lower case", () => {
    const id = "5191d000-0000-4000-8000-00000000000a";
    expect(distinctUuidsInOrder([id.toUpperCase(), id])).toEqual([id]);
  });

  it("returns them in Postgres's order, whatever order or case they came in", () => {
    const first = "0a000000-0000-4000-8000-000000000000";
    const second = "0b000000-0000-4000-8000-000000000000";
    const third = "1a000000-0000-4000-8000-000000000000";
    expect(distinctUuidsInOrder([third, second.toUpperCase(), first, third])).toEqual([
      first,
      second,
      third,
    ]);
  });
});
