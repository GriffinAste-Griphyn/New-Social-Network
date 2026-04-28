ALTER TABLE "creator_profiles" ADD COLUMN "stripe_connected_account_id" text;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD COLUMN "stripe_payouts_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD COLUMN "stripe_onboarding_complete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD COLUMN "stripe_requirements_status" text;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD COLUMN "stripe_requirements_due" text;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD COLUMN "stripe_connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD COLUMN "stripe_updated_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_profiles_stripe_account_idx" ON "creator_profiles" USING btree ("stripe_connected_account_id");