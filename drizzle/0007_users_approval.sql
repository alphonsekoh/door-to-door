CREATE TYPE "public"."approval" AS ENUM('pending', 'approved', 'blocked');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "approval" "approval" DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_unapproved_check" CHECK ("users"."approval" = 'approved' OR ("users"."role" = 'member' AND "users"."deactivated_at" IS NULL));