import type { InterestLevel, Religion } from "@/db/schema";

/*
 * Fixed IDs and timestamps throughout. The seed must produce byte-identical
 * state on every run so tests can rely on it and so re-running never drifts.
 */

export const SEED_PASSWORD = "password123";

const at = (iso: string): Date => new Date(iso);

export type SeedUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
};

export const seedAdmin: SeedUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@example.com",
  name: "Admin User",
  role: "admin",
};

export const seedAlice: SeedUser = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "alice@example.com",
  name: "Alice Tan",
  role: "member",
};

export const seedBen: SeedUser = {
  id: "00000000-0000-4000-8000-000000000003",
  email: "ben@example.com",
  name: "Ben Lim",
  role: "member",
};

export const seedCara: SeedUser = {
  id: "00000000-0000-4000-8000-000000000004",
  email: "cara@example.com",
  name: "Cara Wong",
  role: "member",
};

export const seedUsers: readonly SeedUser[] = [seedAdmin, seedAlice, seedBen, seedCara];

export type SeedBlock = { id: string; name: string; street: string; postalCode: string };

const BLOCK_123 = "00000000-0000-4000-8001-000000000001";
const BLOCK_125 = "00000000-0000-4000-8001-000000000002";
const BLOCK_127 = "00000000-0000-4000-8001-000000000003";
const BLOCK_456 = "00000000-0000-4000-8001-000000000004";

export const seedBlocks: readonly SeedBlock[] = [
  { id: BLOCK_123, name: "123", street: "Ang Mo Kio Ave 3", postalCode: "560123" },
  { id: BLOCK_125, name: "125", street: "Ang Mo Kio Ave 3", postalCode: "560125" },
  { id: BLOCK_127, name: "127", street: "Ang Mo Kio Ave 3", postalCode: "560127" },
  { id: BLOCK_456, name: "456", street: "Bedok North Ave 1", postalCode: "460456" },
];

export type SeedSession = {
  id: string;
  title: string;
  status: "draft" | "active" | "ended";
  startedAt: Date | null;
  endedAt: Date | null;
  blockIds: readonly string[];
};

const MARCH = "00000000-0000-4000-8002-000000000001";
const JUNE = "00000000-0000-4000-8002-000000000002";
const DRAFT = "00000000-0000-4000-8002-000000000003";

export const seedSessions: readonly SeedSession[] = [
  {
    id: MARCH,
    title: "Ang Mo Kio · March outing",
    status: "ended",
    startedAt: at("2026-03-14T10:00:00Z"),
    endedAt: at("2026-03-14T14:30:00Z"),
    blockIds: [BLOCK_123, BLOCK_125],
  },
  {
    id: JUNE,
    title: "Ang Mo Kio · June outing",
    status: "ended",
    startedAt: at("2026-06-20T10:00:00Z"),
    endedAt: at("2026-06-20T15:00:00Z"),
    blockIds: [BLOCK_123, BLOCK_127],
  },
  {
    // Ready for an admin to start, so the start flow is demonstrable on a
    // fresh install without creating anything first.
    id: DRAFT,
    title: "Bedok · upcoming outing",
    status: "draft",
    startedAt: null,
    endedAt: null,
    blockIds: [BLOCK_456],
  },
];

export type SeedHousehold = {
  id: string;
  blockId: string;
  unitNumber: string;
  name: string | null;
  contact: string | null;
  religion: Religion | null;
};

const H_05_123 = "00000000-0000-4000-8003-000000000001";
const H_05_125 = "00000000-0000-4000-8003-000000000002";
const H_06_201 = "00000000-0000-4000-8003-000000000003";
const H_06_203 = "00000000-0000-4000-8003-000000000004";
const H_03_45 = "00000000-0000-4000-8003-000000000005";
const H_11_88 = "00000000-0000-4000-8003-000000000006";

export const seedHouseholds: readonly SeedHousehold[] = [
  {
    id: H_05_123,
    blockId: BLOCK_123,
    unitNumber: "#05-123",
    name: "Mr Tan",
    contact: "+65 9123 4567",
    religion: "buddhist",
  },
  {
    id: H_05_125,
    blockId: BLOCK_123,
    unitNumber: "#05-125",
    name: "Mrs Lee",
    contact: null,
    religion: "christian",
  },
  {
    // Nobody ever answered, so nothing is known. This must be recordable.
    id: H_06_201,
    blockId: BLOCK_123,
    unitNumber: "#06-201",
    name: null,
    contact: null,
    religion: null,
  },
  {
    id: H_06_203,
    blockId: BLOCK_123,
    unitNumber: "#06-203",
    name: "Kumar family",
    contact: "+65 8234 5678",
    religion: "hindu",
  },
  {
    id: H_03_45,
    blockId: BLOCK_125,
    unitNumber: "#03-45",
    name: "Ms Ng",
    contact: null,
    religion: "freethinker",
  },
  {
    id: H_11_88,
    blockId: BLOCK_127,
    unitNumber: "#11-88",
    name: "Mr Rahman",
    contact: "+65 9345 6789",
    religion: "others",
  },
];

export type SeedVisit = {
  id: string;
  householdId: string;
  sessionId: string;
  memberId: string;
  interestLevel: InterestLevel;
  description: string;
  recordedAt: Date;
};

const ALICE = seedAlice.id;
const BEN = seedBen.id;
const CARA = seedCara.id;

/*
 * UUIDv7-shaped ids (version nibble 7), matching what the client generates in
 * the field. The timestamp prefix is fixed so the seed stays deterministic.
 */
export const seedVisits: readonly SeedVisit[] = [
  // --- March outing
  {
    id: "01960000-0000-7000-8000-000000000001",
    householdId: H_05_123,
    sessionId: MARCH,
    memberId: ALICE,
    interestLevel: "low",
    description: "Polite but not interested. Said to try again another time.",
    recordedAt: at("2026-03-14T10:22:00Z"),
  },
  {
    id: "01960000-0000-7000-8000-000000000002",
    householdId: H_05_125,
    sessionId: MARCH,
    memberId: ALICE,
    interestLevel: "medium",
    description: "Listened for a while. Asked what the sessions involve.",
    recordedAt: at("2026-03-14T10:41:00Z"),
  },
  {
    id: "01960000-0000-7000-8000-000000000003",
    householdId: H_06_201,
    sessionId: MARCH,
    memberId: BEN,
    interestLevel: "no_response",
    description: "",
    recordedAt: at("2026-03-14T11:05:00Z"),
  },
  {
    id: "01960000-0000-7000-8000-000000000004",
    householdId: H_06_203,
    sessionId: MARCH,
    memberId: BEN,
    interestLevel: "high",
    description: "Very warm. Asked for a follow-up visit with more information.",
    recordedAt: at("2026-03-14T11:30:00Z"),
  },
  {
    id: "01960000-0000-7000-8000-000000000005",
    householdId: H_03_45,
    sessionId: MARCH,
    memberId: CARA,
    interestLevel: "no_response",
    description: "",
    recordedAt: at("2026-03-14T12:10:00Z"),
  },

  // --- June outing: revisits, so the trajectory over time is visible
  {
    id: "01960000-0000-7000-8000-000000000006",
    householdId: H_05_123,
    sessionId: JUNE,
    memberId: BEN,
    interestLevel: "medium",
    description: "Warmer this time. Remembered the March visit and asked a question.",
    recordedAt: at("2026-06-20T10:15:00Z"),
  },
  {
    id: "01960000-0000-7000-8000-000000000007",
    householdId: H_06_203,
    sessionId: JUNE,
    memberId: ALICE,
    interestLevel: "high",
    description: "Still keen. Wants to be told about the next community event.",
    recordedAt: at("2026-06-20T10:50:00Z"),
  },
  {
    id: "01960000-0000-7000-8000-000000000008",
    householdId: H_06_201,
    sessionId: JUNE,
    memberId: CARA,
    interestLevel: "no_response",
    description: "Second time with no answer.",
    recordedAt: at("2026-06-20T11:20:00Z"),
  },
  {
    id: "01960000-0000-7000-8000-000000000009",
    householdId: H_11_88,
    sessionId: JUNE,
    memberId: CARA,
    interestLevel: "low",
    description: "Busy with family, asked us not to call back.",
    recordedAt: at("2026-06-20T13:05:00Z"),
  },
];

export type SeedFollowUp = {
  id: string;
  householdId: string;
  visitId: string | null;
  authorId: string;
  note: string;
  dueDate: Date | null;
  doneAt: Date | null;
  doneBy: string | null;
};

export const seedFollowUps: readonly SeedFollowUp[] = [
  {
    // Outstanding and overdue, so the actionable list is not empty on install.
    id: "00000000-0000-4000-8004-000000000001",
    householdId: H_06_203,
    visitId: "01960000-0000-7000-8000-000000000007",
    authorId: ALICE,
    note: "Bring the community event flyer and confirm the date.",
    dueDate: at("2026-07-15T00:00:00Z"),
    doneAt: null,
    doneBy: null,
  },
  {
    id: "00000000-0000-4000-8004-000000000002",
    householdId: H_05_123,
    visitId: "01960000-0000-7000-8000-000000000006",
    authorId: BEN,
    note: "Interested in the weekday sessions - check the timings before revisiting.",
    dueDate: at("2026-09-30T00:00:00Z"),
    doneAt: null,
    doneBy: null,
  },
  {
    id: "00000000-0000-4000-8004-000000000003",
    householdId: H_05_125,
    visitId: "01960000-0000-7000-8000-000000000002",
    authorId: ALICE,
    note: "Sent the introduction pamphlet as promised.",
    dueDate: at("2026-04-01T00:00:00Z"),
    doneAt: at("2026-03-28T09:00:00Z"),
    doneBy: ALICE,
  },
];
