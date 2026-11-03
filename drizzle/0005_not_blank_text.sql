ALTER TABLE "blocks" ADD CONSTRAINT "blocks_name_not_blank" CHECK (btrim("blocks"."name") <> '');--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_street_not_blank" CHECK (btrim("blocks"."street") <> '');--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_note_not_blank" CHECK (btrim("follow_ups"."note") <> '');--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_unit_number_not_blank" CHECK (btrim("households"."unit_number") <> '');