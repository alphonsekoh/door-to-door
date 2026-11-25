import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ enums */

export const roleEnum = pgEnum("role", ["admin", "member"]);

export const religionEnum = pgEnum("religion", [
  "buddhist",
  "christian",
  "hindu",
  "freethinker",
  "others",
]);

export const interestLevelEnum = pgEnum("interest_level", ["low", "medium", "high", "no_response"]);

export const sessionStatusEnum = pgEnum("session_status", ["draft", "active", "ended"]);

export const sessionKindEnum = pgEnum("session_kind", ["regular", "follow_up"]);

export const followUpStatusEnum = pgEnum("follow_up_status", ["suggested", "listed"]);

export const approvalEnum = pgEnum("approval", ["pending", "approved", "blocked"]);

/* ------------------------------------------------------------------ users */

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name"),
    email: text("email").notNull().unique(),
    emailVerified: timestamp("email_verified", { withTimezone: true, mode: "date" }),
    image: text("image"),
    // Null for Google-only accounts; only credentials users carry a hash.
    passwordHash: text("password_hash"),
    role: roleEnum("role").notNull().default("member"),
    /*
     * Only a first Google sign-in makes a pending account (#249). The default
     * is approved, so every account an admin or create-admin adds, and every
     * one made before approval existed, is approved with no backfill.
     */
    approval: approvalEnum("approval").notNull().default("approved"),
    // Deactivated users cannot sign in, but their records stay attributed to
    // them - history must survive someone leaving the team.
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true, mode: "date" }),
    /*
     * When the account was erased (#279): the row stays, anonymised, because
     * the visits and notes it recorded still point at it.
     */
    erasedAt: timestamp("erased_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    /*
     * An account nobody has approved is a member, never an admin, and is
     * never deactivated: deactivation is for people who were on the team,
     * and a deactivated account is never put back in the queue.
     */
    check(
      "users_unapproved_check",
      sql`${table.approval} = 'approved' OR (${table.role} = 'member' AND ${table.deactivatedAt} IS NULL)`,
    ),
  ],
);

/* ------------------------------------------------- Auth.js adapter tables */

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })],
);

/*
 * Auth.js uses JWT sessions here (the Credentials provider cannot use database
 * sessions), so this table is unused at runtime. It exists because the Drizzle
 * adapter's schema contract requires it.
 */
export const authSessions = pgTable("auth_sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

/*
 * One row per device or browser signed in (#125). The session JWT names its
 * row in the signInId claim, and every request checks the row is still
 * there, so deleting it ends that sign-in before its token expires. Not the
 * adapter's auth_sessions: that is keyed by a token the JWT strategy never
 * issues.
 */
export const signIns = pgTable(
  "sign_ins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // As sent at sign-in, cut to 512 characters; shown only as a device label.
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("sign_ins_user_idx").on(table.userId)],
);

/* ----------------------------------------------------------------- blocks */

export const blocks = pgTable(
  "blocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    street: text("street").notNull(),
    postalCode: text("postal_code"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("blocks_name_street_unique").on(table.name, table.street),
    index("blocks_street_idx").on(table.street),
    check("blocks_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("blocks_street_not_blank", sql`btrim(${table.street}) <> ''`),
  ],
);

/* --------------------------------------------------------------- sessions */

export const outingSessions = pgTable(
  "outing_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    // Fixed at creation: switching mid-session would rewrite who may record where.
    kind: sessionKindEnum("kind").notNull().default("regular"),
    status: sessionStatusEnum("status").notNull().default("draft"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    /*
     * At most one active session app-wide. Enforced in the database rather
     * than in application code so two concurrent start requests cannot both
     * win - a race the API layer alone cannot close.
     */
    uniqueIndex("one_active_session_idx")
      .on(table.status)
      .where(sql`${table.status} = 'active'`),
    index("outing_sessions_status_idx").on(table.status),
  ],
);

export const sessionBlocks = pgTable(
  "session_blocks",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => outingSessions.id, { onDelete: "cascade" }),
    blockId: uuid("block_id")
      .notNull()
      .references(() => blocks.id, { onDelete: "restrict" }),
    addedAt: timestamp("added_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.blockId] }),
    index("session_blocks_block_idx").on(table.blockId),
  ],
);

/* ------------------------------------------------------ participants, teams */

/* Who has started on an outing. Rows are never removed: there is no un-join. */
export const sessionParticipants = pgTable(
  "session_participants",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => outingSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.userId] })],
);

export const sessionTeams = pgTable(
  "session_teams",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => outingSessions.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("session_teams_session_idx").on(table.sessionId),
    // Target of the composite key below, so a member row cannot name a team
    // from a different session than its own.
    unique("session_teams_id_session_unique").on(table.id, table.sessionId),
  ],
);

export const sessionTeamMembers = pgTable(
  "session_team_members",
  {
    teamId: uuid("team_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId] }),
    // One team per member per outing, enforced here so two concurrent
    // "create a team" requests cannot both place the same person.
    unique("session_team_members_session_user_unique").on(table.sessionId, table.userId),
    foreignKey({
      columns: [table.teamId, table.sessionId],
      foreignColumns: [sessionTeams.id, sessionTeams.sessionId],
      name: "session_team_members_team_session_fk",
    }).onDelete("cascade"),
  ],
);

/* ------------------------------------------------------------- households */

/*
 * A household is a unit in a block, identified by (block_id, unit_number).
 * Identity fields are "latest known" and are only ever updated with non-null
 * values, so a later visit that learns nothing cannot erase what an earlier
 * visit recorded.
 */
export const households = pgTable(
  "households",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    blockId: uuid("block_id")
      .notNull()
      .references(() => blocks.id, { onDelete: "restrict" }),
    unitNumber: text("unit_number").notNull(),
    name: text("name"),
    contact: text("contact"),
    religion: religionEnum("religion"),
    /*
     * Set when the household's data was erased (#279): the row stays as the
     * unit alone, so a record made before this moment is refused rather than
     * recreating it.
     */
    erasedAt: timestamp("erased_at", { withTimezone: true, mode: "date" }),
    // When someone marked the contact as not to be called or messaged.
    contactWithdrawnAt: timestamp("contact_withdrawn_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("households_block_unit_unique").on(table.blockId, table.unitNumber),
    index("households_block_idx").on(table.blockId),
    /*
     * The last guard behind the contract and the services (#119): a blank
     * unit or note fails the response contract, so one stored row turned
     * every read that included it into a 500. Fails with 23514 on a database
     * that already holds one; `npm run db:check-blank` lists them.
     */
    check("households_unit_number_not_blank", sql`btrim(${table.unitNumber}) <> ''`),
  ],
);

/*
 * The households an admin picked for a follow-up session, at least one from
 * creation on. The session's blocks are exactly these households' blocks,
 * kept in step by the service, so a member never opens an empty block. Picks
 * change only when an admin adds or removes one, so an ended session keeps a
 * truthful record of what it set out to do.
 */
export const sessionHouseholds = pgTable(
  "session_households",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => outingSessions.id, { onDelete: "cascade" }),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.householdId] }),
    index("session_households_household_idx").on(table.householdId),
  ],
);

/* ----------------------------------------------------------------- visits */

/*
 * One knock. interest_level and description belong here and are never
 * overwritten by a later visit, so the interest trajectory over time stays
 * visible.
 *
 * `id` is supplied by the client (UUIDv7), not defaulted by the database.
 * That is what makes the offline queue idempotent: replaying a queued write
 * upserts the same row instead of creating a duplicate. Do not add a default.
 */
export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => outingSessions.id, { onDelete: "restrict" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // Stamped once on insert and never updated: the team the author was on
    // when the server first stored the visit. Null when they were on none.
    teamId: uuid("team_id").references(() => sessionTeams.id, { onDelete: "restrict" }),
    interestLevel: interestLevelEnum("interest_level").notNull(),
    description: text("description").notNull().default(""),
    // When the device recorded it, which can be well before it reached us.
    clientCreatedAt: timestamp("client_created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    // Drives last-write-wins when a queued offline edit arrives out of order.
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    index("visits_household_created_idx").on(table.householdId, table.createdAt),
    index("visits_session_idx").on(table.sessionId),
    index("visits_member_idx").on(table.memberId),
    index("visits_team_idx").on(table.teamId),
    /* All records' order (listHistory), newest first with the id settling a
       tie (#212): read off the index rather than sorting every visit.
       NULLS FIRST is what a plain DESC sorts by; Drizzle's default, NULLS
       LAST, would leave the planner sorting anyway. */
    index("visits_created_id_idx").on(
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
  ],
);

/*
 * Who was on the author's team when the visit was stored: a snapshot, written
 * with the visit and never updated or deleted. Only present when team_id is.
 * Names are resolved at read time, so a rename shows and a leaver stays shown.
 */
export const visitTeammates = pgTable(
  "visit_teammates",
  {
    visitId: uuid("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [primaryKey({ columns: [table.visitId, table.userId] })],
);

/* -------------------------------------------------------------- follow-ups */

/*
 * Attached to the household, not the session, so a note written in January is
 * still there when someone knocks on that door in August.
 *
 * A `listed` note is on the follow-up list, which only an admin decides; a
 * `suggested` one is a member asking for a return visit. Removal is soft: the
 * row stays with who removed it and why, so a declined suggestion can be
 * explained to its author and an admin can audit what left the list.
 */
export const followUps = pgTable(
  "follow_ups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id").references(() => visits.id, { onDelete: "set null" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // The default backfills notes written before suggestions existed as listed.
    status: followUpStatusEnum("status").notNull().default("listed"),
    note: text("note").notNull(),
    dueDate: timestamp("due_date", { withTimezone: true, mode: "date" }),
    doneAt: timestamp("done_at", { withTimezone: true, mode: "date" }),
    doneBy: uuid("done_by").references(() => users.id, { onDelete: "set null" }),
    /*
     * The visit whose recording marked it done, in a follow-up session; null
     * when it was marked done by hand. Read back, so a replayed visit names
     * the same notes, and an undo reopens exactly those. Reopening clears it.
     */
    doneVisitId: uuid("done_visit_id").references(() => visits.id, { onDelete: "set null" }),
    listedAt: timestamp("listed_at", { withTimezone: true, mode: "date" }),
    listedBy: uuid("listed_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
    deleteReason: text("delete_reason"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("follow_ups_household_idx").on(table.householdId),
    // Outstanding notes are the actionable list; this is the query behind it.
    index("follow_ups_outstanding_idx").on(table.doneAt, table.dueDate),
    /*
     * One pending suggestion per household, held here so two members
     * suggesting the same door at once cannot both succeed.
     */
    uniqueIndex("follow_ups_one_open_suggestion_idx")
      .on(table.householdId)
      .where(sql`${table.status} = 'suggested' and ${table.deletedAt} is null`),
    index("follow_ups_done_visit_idx")
      .on(table.doneVisitId)
      .where(sql`${table.doneVisitId} is not null`),
    check("follow_ups_note_not_blank", sql`btrim(${table.note}) <> ''`),
  ],
);

/* ----------------------------------------------------------------- privacy */

/*
 * A request to erase a household's or an account's data, and once carried out
 * the record that it was. Holds no personal data: who asked is the subject
 * itself, and there is no free text.
 */
export const erasureRequests = pgTable(
  "erasure_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id").references(() => households.id, { onDelete: "restrict" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" }).notNull(),
    loggedBy: uuid("logged_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    loggedAt: timestamp("logged_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    erasedAt: timestamp("erased_at", { withTimezone: true, mode: "date" }),
    erasedBy: uuid("erased_by").references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [
    check(
      "erasure_requests_one_subject_check",
      sql`(${table.householdId} IS NULL) <> (${table.userId} IS NULL)`,
    ),
    check(
      "erasure_requests_erased_by_check",
      sql`${table.erasedBy} IS NULL OR ${table.erasedAt} IS NOT NULL`,
    ),
    // One open request per subject, held here so two admins cannot both log it.
    uniqueIndex("erasure_requests_one_open_household_idx")
      .on(table.householdId)
      .where(sql`${table.erasedAt} IS NULL`),
    uniqueIndex("erasure_requests_one_open_user_idx")
      .on(table.userId)
      .where(sql`${table.erasedAt} IS NULL`),
    index("erasure_requests_erased_idx").on(table.erasedAt),
  ],
);

/*
 * One row per run of the retention job: its counts, and the lease that keeps
 * two runs from overlapping (an advisory lock does not hold through a
 * transaction-mode pooler).
 */
export const retentionRuns = pgTable(
  "retention_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    households: integer("households").notNull().default(0),
    accounts: integer("accounts").notNull().default(0),
    signIns: integer("sign_ins").notNull().default(0),
    more: boolean("more").notNull().default(false),
  },
  (table) => [
    // At most one unfinished run: every such row indexes the same value.
    uniqueIndex("retention_runs_one_unfinished_idx")
      .on(sql`(true)`)
      .where(sql`${table.finishedAt} IS NULL`),
  ],
);

/* ------------------------------------------------------------------ types */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Block = typeof blocks.$inferSelect;
export type NewBlock = typeof blocks.$inferInsert;
export type OutingSession = typeof outingSessions.$inferSelect;
export type NewOutingSession = typeof outingSessions.$inferInsert;
export type Household = typeof households.$inferSelect;
export type NewHousehold = typeof households.$inferInsert;
export type Visit = typeof visits.$inferSelect;
export type NewVisit = typeof visits.$inferInsert;
export type SessionTeam = typeof sessionTeams.$inferSelect;
export type FollowUp = typeof followUps.$inferSelect;
export type NewFollowUp = typeof followUps.$inferInsert;

export type ErasureRequestRow = typeof erasureRequests.$inferSelect;
export type RetentionRunRow = typeof retentionRuns.$inferSelect;

export type Role = (typeof roleEnum.enumValues)[number];
export type Religion = (typeof religionEnum.enumValues)[number];
export type InterestLevel = (typeof interestLevelEnum.enumValues)[number];
export type SessionStatus = (typeof sessionStatusEnum.enumValues)[number];
export type SessionKind = (typeof sessionKindEnum.enumValues)[number];
export type FollowUpStatus = (typeof followUpStatusEnum.enumValues)[number];
export type Approval = (typeof approvalEnum.enumValues)[number];
