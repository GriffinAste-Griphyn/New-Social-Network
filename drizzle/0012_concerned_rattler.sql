ALTER TABLE "earnings_ledger" ADD COLUMN "story_id" text;--> statement-breakpoint
ALTER TABLE "earnings_ledger" ADD COLUMN "stripe_transfer_id" text;--> statement-breakpoint
ALTER TABLE "earnings_ledger" ADD COLUMN "stripe_transfer_status" text;--> statement-breakpoint
ALTER TABLE "earnings_ledger" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "earnings_ledger" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "earnings_ledger" ADD CONSTRAINT "earnings_ledger_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_match_events_story_profile_idx" ON "brand_match_events" USING btree ("story_id","funding_profile_id");--> statement-breakpoint
CREATE INDEX "earnings_ledger_user_status_idx" ON "earnings_ledger" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "earnings_ledger_story_idx" ON "earnings_ledger" USING btree ("story_id");--> statement-breakpoint
CREATE UNIQUE INDEX "earnings_ledger_source_user_idx" ON "earnings_ledger" USING btree ("source","source_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "earnings_ledger_stripe_transfer_idx" ON "earnings_ledger" USING btree ("stripe_transfer_id");