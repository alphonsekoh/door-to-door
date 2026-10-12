CREATE TABLE "session_participants" (
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_participants_session_id_user_id_pk" PRIMARY KEY("session_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "session_team_members" (
	"team_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id"),
	CONSTRAINT "session_team_members_session_user_unique" UNIQUE("session_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "session_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_teams_id_session_unique" UNIQUE("id","session_id")
);
--> statement-breakpoint
CREATE TABLE "visit_teammates" (
	"visit_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "visit_teammates_visit_id_user_id_pk" PRIMARY KEY("visit_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_session_id_outing_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."outing_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_team_members" ADD CONSTRAINT "session_team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_team_members" ADD CONSTRAINT "session_team_members_team_session_fk" FOREIGN KEY ("team_id","session_id") REFERENCES "public"."session_teams"("id","session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_teams" ADD CONSTRAINT "session_teams_session_id_outing_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."outing_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_teams" ADD CONSTRAINT "session_teams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_teammates" ADD CONSTRAINT "visit_teammates_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_teammates" ADD CONSTRAINT "visit_teammates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_teams_session_idx" ON "session_teams" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_team_id_session_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."session_teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visits_team_idx" ON "visits" USING btree ("team_id");