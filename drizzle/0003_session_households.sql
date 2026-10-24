CREATE TABLE "session_households" (
	"session_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_households_session_id_household_id_pk" PRIMARY KEY("session_id","household_id")
);
--> statement-breakpoint
ALTER TABLE "session_households" ADD CONSTRAINT "session_households_session_id_outing_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."outing_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_households" ADD CONSTRAINT "session_households_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_households_household_idx" ON "session_households" USING btree ("household_id");