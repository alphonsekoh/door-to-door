CREATE TYPE "public"."follow_up_status" AS ENUM('suggested', 'listed');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('regular', 'follow_up');--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "status" "follow_up_status" DEFAULT 'listed' NOT NULL;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "listed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "listed_by" uuid;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "outing_sessions" ADD COLUMN "kind" "session_kind" DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_listed_by_users_id_fk" FOREIGN KEY ("listed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "follow_ups_one_open_suggestion_idx" ON "follow_ups" USING btree ("household_id") WHERE "follow_ups"."status" = 'suggested' and "follow_ups"."deleted_at" is null;