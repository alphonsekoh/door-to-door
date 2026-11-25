CREATE TABLE "erasure_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"user_id" uuid,
	"requested_at" timestamp with time zone NOT NULL,
	"logged_by" uuid NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"erased_at" timestamp with time zone,
	"erased_by" uuid,
	CONSTRAINT "erasure_requests_one_subject_check" CHECK (("erasure_requests"."household_id" IS NULL) <> ("erasure_requests"."user_id" IS NULL)),
	CONSTRAINT "erasure_requests_erased_by_check" CHECK ("erasure_requests"."erased_by" IS NULL OR "erasure_requests"."erased_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "retention_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"households" integer DEFAULT 0 NOT NULL,
	"accounts" integer DEFAULT 0 NOT NULL,
	"sign_ins" integer DEFAULT 0 NOT NULL,
	"more" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "contact_withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "erasure_requests" ADD CONSTRAINT "erasure_requests_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erasure_requests" ADD CONSTRAINT "erasure_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erasure_requests" ADD CONSTRAINT "erasure_requests_logged_by_users_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erasure_requests" ADD CONSTRAINT "erasure_requests_erased_by_users_id_fk" FOREIGN KEY ("erased_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "erasure_requests_one_open_household_idx" ON "erasure_requests" USING btree ("household_id") WHERE "erasure_requests"."erased_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "erasure_requests_one_open_user_idx" ON "erasure_requests" USING btree ("user_id") WHERE "erasure_requests"."erased_at" IS NULL;--> statement-breakpoint
CREATE INDEX "erasure_requests_erased_idx" ON "erasure_requests" USING btree ("erased_at");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_runs_one_unfinished_idx" ON "retention_runs" USING btree ((true)) WHERE "retention_runs"."finished_at" IS NULL;