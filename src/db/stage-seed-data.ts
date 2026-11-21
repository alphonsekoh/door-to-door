import type { FollowUpStatus, InterestLevel, Religion, SessionKind } from "@/db/schema";
import { uuidv7 } from "@/lib/uuid";

/*
 * A year of a busy team's records, for the stage stack only (#244): enough
 * rows that a query which is fine on the demo seed's handful shows its cost
 * here, as it would in production. Never the demo seed, and never production:
 * see stage-seed.ts for the guards.
 *
 * Deterministic for a given seed and `now`, so two runs of the stage check
 * against freshly seeded stacks compare like with like. Ids are UUIDv7, as
 * the phones make them, drawn from the same generator.
 */

export const STAGE_PASSWORD = "stage-password";
export const STAGE_EMAIL_DOMAIN = "stage.example.com";
export const STAGE_ADMIN_EMAIL = `admin@${STAGE_EMAIL_DOMAIN}`;
export const stageMemberEmail = (n: number): string =>
  `member${String(n).padStart(2, "0")}@${STAGE_EMAIL_DOMAIN}`;
export const STAGE_MEMBER_EMAIL = stageMemberEmail(1);

export type StageScale = {
  blocks: number;
  unitsPerBlock: { min: number; max: number };
  admins: number;
  members: number;
  /* The last members, left two months ago; their records stay theirs. */
  deactivatedMembers: number;
  /* Weekly door-to-door sessions before today's. */
  endedSessions: number;
  blocksPerSession: number;
  followUpSessions: number;
  /* The share of a session's units knocked. */
  coverage: number;
};

/* About 3,000 households and 15,000 visits; README, Stage environment. */
export const STAGE_SCALE = {
  blocks: 30,
  unitsPerBlock: { min: 80, max: 120 },
  admins: 3,
  members: 40,
  deactivatedMembers: 2,
  endedSessions: 48,
  blocksPerSession: 4,
  followUpSessions: 4,
  coverage: 0.75,
} as const satisfies StageScale;

/* member01 to member38 can sign in; the last two have left. */
export const STAGE_ACTIVE_MEMBERS = STAGE_SCALE.members - STAGE_SCALE.deactivatedMembers;

export type StageUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  deactivatedAt: Date | null;
  createdAt: Date;
};

export type StageBlock = {
  id: string;
  name: string;
  street: string;
  postalCode: string;
  createdAt: Date;
};

export type StageSession = {
  id: string;
  title: string;
  kind: SessionKind;
  status: "draft" | "active" | "ended";
  startedAt: Date | null;
  endedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type StageHousehold = {
  id: string;
  blockId: string;
  unitNumber: string;
  name: string | null;
  contact: string | null;
  religion: Religion | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StageVisit = {
  id: string;
  householdId: string;
  sessionId: string;
  memberId: string;
  teamId: string | null;
  interestLevel: InterestLevel;
  description: string;
  clientCreatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type StageFollowUp = {
  id: string;
  householdId: string;
  visitId: string;
  authorId: string;
  status: FollowUpStatus;
  note: string;
  dueDate: Date | null;
  doneAt: Date | null;
  doneBy: string | null;
  doneVisitId: string | null;
  listedAt: Date | null;
  listedBy: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  deleteReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StageData = {
  users: StageUser[];
  blocks: StageBlock[];
  sessions: StageSession[];
  sessionBlocks: { sessionId: string; blockId: string; addedAt: Date }[];
  sessionParticipants: { sessionId: string; userId: string; joinedAt: Date }[];
  sessionTeams: {
    id: string;
    sessionId: string;
    name: string;
    createdBy: string;
    createdAt: Date;
  }[];
  sessionTeamMembers: { teamId: string; sessionId: string; userId: string; joinedAt: Date }[];
  households: StageHousehold[];
  sessionHouseholds: { sessionId: string; householdId: string; addedAt: Date }[];
  visits: StageVisit[];
  visitTeammates: { visitId: string; userId: string }[];
  followUps: StageFollowUp[];
};

type NonEmpty<T> = readonly [T, ...T[]];

export type Random = {
  next: () => number;
  int: (min: number, max: number) => number;
  chance: (probability: number) => boolean;
  pick: <T>(items: NonEmpty<T>) => T;
  shuffle: <T>(items: readonly T[]) => T[];
};

/* mulberry32: small, and the same sequence on every machine, which Math.random is not. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    chance: (probability) => next() < probability,
    pick: (items) => {
      const at = int(0, items.length - 1);
      return items.reduce((chosen, item, index) => (index === at ? item : chosen));
    },
    shuffle: (items) =>
      items
        .map((item) => ({ item, key: next() }))
        .sort((a, b) => a.key - b.key)
        .map(({ item }) => item),
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const later = (at: Date, ms: number): Date => new Date(at.getTime() + ms);
const earliest = (a: Date, b: Date): Date => (a < b ? a : b);
const latest = (dates: readonly Date[], from: Date): Date =>
  dates.reduce((max, date) => (date > max ? date : max), from);
const first = (dates: readonly Date[], from: Date): Date =>
  dates.reduce((min, date) => (date < min ? date : min), from);

/* Slices of `size`, the last one shorter. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, at) =>
    items.slice(at * size, (at + 1) * size),
  );
}

const pad = (value: number, width: number): string => String(value).padStart(width, "0");
const day = (at: Date): string => at.toISOString().slice(0, 10);

const STREETS = [
  { street: "Ang Mo Kio Ave 3", postal: "56" },
  { street: "Bedok North Ave 1", postal: "46" },
  { street: "Tampines St 21", postal: "52" },
  { street: "Jurong West St 42", postal: "64" },
] as const;

const FIRST_NAMES = [
  "Alice",
  "Ben",
  "Cara",
  "Daniel",
  "Esther",
  "Farid",
  "Grace",
  "Hui Min",
  "Isaac",
  "Joanna",
  "Kumar",
  "Lydia",
  "Marcus",
  "Nadia",
  "Peter",
  "Rachel",
] as const;
const SURNAMES = ["Tan", "Lim", "Lee", "Ng", "Wong", "Goh", "Chua", "Koh", "Ong", "Teo"] as const;
const TITLES = ["Mr", "Mrs", "Ms", "Mdm"] as const;
const RELIGIONS = ["buddhist", "christian", "hindu", "freethinker", "others"] as const;

const DESCRIPTIONS = {
  no_response: ["", "", "No answer.", "Gate locked, lights off.", "Dog barking, nobody came."],
  low: [
    "Polite but not interested.",
    "Busy, said no thanks.",
    "Took the flyer at the gate.",
    "Asked us not to come back this month.",
  ],
  medium: [
    "Listened for a while. Asked what the sessions involve.",
    "Took a flyer and asked about weekend times.",
    "Interested, but caring for a parent at home.",
    "Asked us to come back when the children are home.",
  ],
  high: [
    "Wants to visit on Sunday with the family.",
    "Asked for a call back this week.",
    "Prayed with us at the door. Asked for a Bible.",
    "Keen to join the next gathering; gave a number.",
  ],
} as const satisfies Record<InterestLevel, NonEmpty<string>>;

const NOTES = [
  "Call before visiting; works shifts.",
  "Bring the Mandarin flyer.",
  "Asked for an evening visit.",
  "Follow up about Sunday transport.",
  "Daughter is interested too.",
  "Go back with a sister; prefers to talk to women.",
] as const;
const REMOVE_REASONS = [
  "Moved out of the block.",
  "Asked not to be visited again.",
  "Duplicate of another note.",
  "Wrong unit number.",
] as const;

/* Most doors do not open; a few say yes. */
function interestFor(roll: number): InterestLevel {
  if (roll < 0.45) return "no_response";
  if (roll < 0.7) return "low";
  if (roll < 0.88) return "medium";
  return "high";
}

type Unit = { id: string; blockId: string; unitNumber: string };

export type StageOptions = { now: Date; seed?: number; scale?: StageScale };

export function generateStageData({
  now,
  seed = 244,
  scale = STAGE_SCALE,
}: StageOptions): StageData {
  const random = createRandom(seed);
  const id = (at: Date): string => uuidv7(at.getTime(), random.next);
  const joined = later(now, -400 * DAY);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  /* ------------------------------------------------------------ people */

  const user = (email: string, name: string, role: StageUser["role"]): StageUser => ({
    id: id(joined),
    email,
    name,
    role,
    deactivatedAt: null,
    createdAt: joined,
  });
  const memberName = () => `${random.pick(FIRST_NAMES)} ${random.pick(SURNAMES)}`;
  const admins: NonEmpty<StageUser> = [
    user(STAGE_ADMIN_EMAIL, "Stage Admin", "admin"),
    ...Array.from({ length: scale.admins - 1 }, (_, at) =>
      user(`admin${String(at + 2)}@${STAGE_EMAIL_DOMAIN}`, memberName(), "admin"),
    ),
  ];
  const left = later(now, -60 * DAY);
  const members = Array.from({ length: scale.members }, (_, at) => ({
    ...user(stageMemberEmail(at + 1), memberName(), "member"),
    deactivatedAt: at >= scale.members - scale.deactivatedMembers ? left : null,
  }));
  const activeAt = (at: Date) =>
    members.filter((member) => member.deactivatedAt === null || member.deactivatedAt > at);

  /* ------------------------------------------------------------ places */

  const perStreet = Math.ceil(scale.blocks / STREETS.length);
  const blocks: StageBlock[] = STREETS.flatMap(({ street, postal }, streetAt) =>
    Array.from({ length: perStreet }, (_, at) => {
      const name = String(101 + streetAt * 100 + at);
      return {
        id: id(joined),
        name,
        street,
        postalCode: `${postal}${pad(Number(name), 4)}`,
        createdAt: joined,
      };
    }),
  ).slice(0, scale.blocks);

  /* Twelve floors, two units apart, so every block reads like an HDB block. */
  const units: Unit[] = blocks.flatMap((block) =>
    Array.from(
      { length: random.int(scale.unitsPerBlock.min, scale.unitsPerBlock.max) },
      (_, at) => ({
        id: id(joined),
        blockId: block.id,
        unitNumber: `#${pad(2 + (at % 12), 2)}-${String(101 + Math.floor(at / 12) * 2)}`,
      }),
    ),
  );
  const unitsIn = (blockIds: readonly string[]) =>
    units.filter((unit) => blockIds.includes(unit.blockId));
  /* Each session takes the next few blocks round the estate. */
  const ring = [...blocks, ...blocks];
  const blocksFrom = (start: number) =>
    ring.slice(start % blocks.length, (start % blocks.length) + scale.blocksPerSession);

  /* ------------------------------------------------------------ records */

  const data: StageData = {
    users: [...admins, ...members],
    blocks,
    sessions: [],
    sessionBlocks: [],
    sessionParticipants: [],
    sessionTeams: [],
    sessionTeamMembers: [],
    households: [],
    sessionHouseholds: [],
    visits: [],
    visitTeammates: [],
    followUps: [],
  };

  type Window = { start: Date; end: Date };

  function addSession(
    kind: SessionKind,
    title: string,
    status: StageSession["status"],
    window: Window,
    blockIds: readonly string[],
  ): StageSession {
    /* Set up a few days ahead, or yesterday for one not yet started. */
    const createdAt = earliest(later(window.start, -3 * DAY), later(now, -DAY));
    const session: StageSession = {
      id: id(createdAt),
      title,
      kind,
      status,
      startedAt: status === "draft" ? null : window.start,
      endedAt: status === "ended" ? window.end : null,
      createdBy: admins[0].id,
      createdAt,
      updatedAt: status === "ended" ? window.end : createdAt,
    };
    data.sessions.push(session);
    for (const blockId of blockIds) {
      data.sessionBlocks.push({ sessionId: session.id, blockId, addedAt: createdAt });
    }
    return session;
  }

  /*
   * The session's people, paired into teams when `teams`, each knocking on
   * the next run of `doors` in turn.
   */
  function knock(
    session: StageSession,
    window: Window,
    people: number,
    teams: boolean,
    doors: readonly Unit[],
  ) {
    const participants = random.shuffle(activeAt(window.start)).slice(0, people);
    const teamOf = new Map<string, { teamId: string; mates: string[] }>();
    for (const userRow of participants) {
      data.sessionParticipants.push({
        sessionId: session.id,
        userId: userRow.id,
        joinedAt: window.start,
      });
    }
    const pairs = chunk(participants, 2).filter((pair) => teams && pair.length === 2);
    for (const [at, pair] of pairs.entries()) {
      const teamId = id(window.start);
      const ids = pair.map((member) => member.id);
      data.sessionTeams.push({
        id: teamId,
        sessionId: session.id,
        name: `Team ${String(at + 1)}`,
        createdBy: pair.reduce((first) => first).id,
        createdAt: window.start,
      });
      for (const userId of ids) {
        data.sessionTeamMembers.push({
          teamId,
          sessionId: session.id,
          userId,
          joinedAt: window.start,
        });
        teamOf.set(userId, { teamId, mates: ids.filter((other) => other !== userId) });
      }
    }
    const share = Math.ceil(doors.length / Math.max(participants.length, 1));
    return participants.flatMap((member, at) =>
      doors.slice(at * share, (at + 1) * share).map((unit) => {
        const recordedAt = later(
          window.start,
          random.int(0, window.end.getTime() - window.start.getTime()),
        );
        const team = teamOf.get(member.id);
        const interestLevel = interestFor(random.next());
        const visit: StageVisit = {
          id: id(recordedAt),
          householdId: unit.id,
          sessionId: session.id,
          memberId: member.id,
          teamId: team?.teamId ?? null,
          interestLevel,
          description: random.pick(DESCRIPTIONS[interestLevel]),
          clientCreatedAt: recordedAt,
          createdAt: recordedAt,
          updatedAt: recordedAt,
        };
        data.visits.push(visit);
        for (const userId of team?.mates ?? [])
          data.visitTeammates.push({ visitId: visit.id, userId });
        return visit;
      }),
    );
  }

  /* Weekly sessions over the past year, 10:00 to 14:30 in Singapore. */
  for (let week = scale.endedSessions; week >= 1; week -= 1) {
    const start = later(today, -7 * week * DAY + 2 * HOUR);
    const window = { start, end: later(start, 4.5 * HOUR) };
    const blockIds = blocksFrom(week * scale.blocksPerSession).map((block) => block.id);
    const session = addSession(
      "regular",
      `Door to door · ${day(start)}`,
      "ended",
      window,
      blockIds,
    );
    const doors = random.shuffle(unitsIn(blockIds));
    knock(
      session,
      window,
      random.int(8, 14),
      random.chance(0.6),
      doors.slice(0, Math.round(doors.length * scale.coverage)),
    );
  }

  /* Today's, under way for an hour and a half, a third of its doors done. */
  const activeStart = later(now, -90 * MINUTE);
  const activeBlocks = blocksFrom(0).slice(0, 3);
  const active = addSession(
    "regular",
    `Door to door · ${day(now)}`,
    "active",
    { start: activeStart, end: now },
    activeBlocks.map((block) => block.id),
  );
  const activeDoors = random.shuffle(unitsIn(activeBlocks.map((block) => block.id)));
  knock(
    active,
    { start: activeStart, end: later(now, -MINUTE) },
    random.int(8, 12),
    true,
    activeDoors.slice(0, Math.round(activeDoors.length * scale.coverage * 0.4)),
  );

  /* Next week's, set up and waiting. */
  addSession(
    "regular",
    "Door to door · next week",
    "draft",
    { start: later(now, 7 * DAY), end: later(now, 7 * DAY) },
    blocksFrom(scale.blocksPerSession).map((block) => block.id),
  );

  /* ------------------------------------------------------------ follow-ups */

  const openSuggestion = new Set<string>();
  const sorted = [...data.visits].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const visit of sorted) {
    const worth =
      visit.interestLevel === "high" ? 0.5 : visit.interestLevel === "medium" ? 0.15 : 0;
    if (!random.chance(worth)) continue;
    const createdAt = earliest(
      later(visit.createdAt, random.int(5 * MINUTE, 2 * DAY)),
      later(now, -MINUTE),
    );
    const suggested = random.chance(0.3) && !openSuggestion.has(visit.householdId);
    const removed = random.chance(0.12);
    const listedAt = suggested ? null : earliest(later(createdAt, random.int(0, 3 * DAY)), now);
    const deletedAt = removed ? earliest(later(createdAt, random.int(HOUR, 10 * DAY)), now) : null;
    if (suggested && !removed) openSuggestion.add(visit.householdId);
    data.followUps.push({
      id: id(createdAt),
      householdId: visit.householdId,
      visitId: visit.id,
      authorId: suggested || random.chance(0.5) ? visit.memberId : random.pick(admins).id,
      status: suggested ? "suggested" : "listed",
      note: random.pick(NOTES),
      dueDate: random.chance(suggested ? 0.3 : 0.7)
        ? later(createdAt, random.int(7, 60) * DAY)
        : null,
      doneAt: null,
      doneBy: null,
      doneVisitId: null,
      listedAt,
      listedBy: listedAt === null ? null : random.pick(admins).id,
      deletedAt,
      deletedBy: deletedAt === null ? null : random.pick(admins).id,
      deleteReason: deletedAt === null ? null : random.pick(REMOVE_REASONS),
      createdAt,
      updatedAt: latest([listedAt ?? createdAt, deletedAt ?? createdAt], createdAt),
    });
  }

  /* A few Sundays a year an admin sends a team back to the list. */
  for (let round = 1; round <= scale.followUpSessions; round += 1) {
    const daysAgo =
      Math.round((round * scale.endedSessions * 7) / (scale.followUpSessions + 1)) - 1;
    const start = later(today, -daysAgo * DAY + 2 * HOUR);
    const window = { start, end: later(start, 3 * HOUR) };
    const outstanding = data.followUps.filter(
      (note) =>
        note.status === "listed" &&
        note.deletedAt === null &&
        note.doneAt === null &&
        note.createdAt < later(start, -DAY),
    );
    const listed = new Set(outstanding.map((note) => note.householdId));
    const doors = random
      .shuffle(units.filter((unit) => listed.has(unit.id)))
      .slice(0, random.int(20, 40));
    /* A follow-up session never has fewer than one household. */
    if (doors.length === 0) continue;
    const session = addSession("follow_up", `Return visits · ${day(start)}`, "ended", window, [
      ...new Set(doors.map((unit) => unit.blockId)),
    ]);
    for (const unit of doors) {
      data.sessionHouseholds.push({
        sessionId: session.id,
        householdId: unit.id,
        addedAt: session.createdAt,
      });
    }
    for (const visit of knock(session, window, random.int(4, 6), false, doors)) {
      for (const note of outstanding) {
        if (note.householdId !== visit.householdId || !random.chance(0.6)) continue;
        note.doneAt = visit.createdAt;
        note.doneBy = visit.memberId;
        note.doneVisitId = visit.id;
        note.updatedAt = latest([visit.createdAt], note.updatedAt);
      }
    }
  }

  /* Older notes are often settled by hand, without a return visit recorded. */
  for (const note of data.followUps) {
    const settled =
      note.status === "listed" &&
      note.deletedAt === null &&
      note.doneAt === null &&
      note.createdAt < later(now, -45 * DAY) &&
      random.chance(0.4);
    if (!settled) continue;
    note.doneAt = earliest(later(note.createdAt, random.int(3, 40) * DAY), later(now, -DAY));
    note.doneBy = random.pick(admins).id;
    note.updatedAt = latest([note.doneAt], note.updatedAt);
  }

  /* ------------------------------------------------------------ households */

  /* Only doors someone knocked on are households; identity is learnt from an answer. */
  const visitsAt = Map.groupBy(data.visits, (visit) => visit.householdId);
  for (const unit of units) {
    const knocked = visitsAt.get(unit.id);
    if (knocked === undefined) continue;
    const answered = knocked.some((visit) => visit.interestLevel !== "no_response");
    const times = knocked.map((visit) => visit.createdAt);
    data.households.push({
      id: unit.id,
      blockId: unit.blockId,
      unitNumber: unit.unitNumber,
      name:
        answered && random.chance(0.7) ? `${random.pick(TITLES)} ${random.pick(SURNAMES)}` : null,
      contact:
        answered && random.chance(0.4)
          ? `+65 9${pad(random.int(0, 999), 3)} ${pad(random.int(0, 9999), 4)}`
          : null,
      religion: answered && random.chance(0.7) ? random.pick(RELIGIONS) : null,
      createdAt: first(times, now),
      updatedAt: latest(times, joined),
    });
  }

  return data;
}

export type StageCounts = Record<keyof StageData, number>;

export function countStageData(data: StageData): StageCounts {
  return {
    users: data.users.length,
    blocks: data.blocks.length,
    sessions: data.sessions.length,
    sessionBlocks: data.sessionBlocks.length,
    sessionParticipants: data.sessionParticipants.length,
    sessionTeams: data.sessionTeams.length,
    sessionTeamMembers: data.sessionTeamMembers.length,
    households: data.households.length,
    sessionHouseholds: data.sessionHouseholds.length,
    visits: data.visits.length,
    visitTeammates: data.visitTeammates.length,
    followUps: data.followUps.length,
  };
}
