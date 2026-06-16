CREATE TYPE "public"."daily_ad_view_status" AS ENUM('pending', 'started', 'completed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."daily_campaign_status" AS ENUM('draft', 'pending_review', 'active', 'paused', 'completed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."daily_entry_status" AS ENUM('eligible', 'held', 'void');--> statement-breakpoint
CREATE TYPE "public"."daily_pool_status" AS ENUM('open', 'drawing', 'drawn', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."daily_session_status" AS ENUM('started', 'paused', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."daily_winner_status" AS ENUM('pending', 'approved', 'paid', 'held', 'void');--> statement-breakpoint

CREATE TABLE "daily_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"advertiser_account_id" text NOT NULL,
	"name" text NOT NULL,
	"brand_name" text NOT NULL,
	"status" "daily_campaign_status" DEFAULT 'draft' NOT NULL,
	"video_url" text NOT NULL,
	"thumbnail_url" text,
	"destination_url" text NOT NULL,
	"cta_text" text DEFAULT 'Learn more' NOT NULL,
	"targeting_summary" text,
	"daily_budget_cents" integer NOT NULL,
	"total_budget_cents" integer,
	"max_daily_impressions" integer,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "daily_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"pool_date" text NOT NULL,
	"status" "daily_session_status" DEFAULT 'started' NOT NULL,
	"current_ad_index" integer DEFAULT 0 NOT NULL,
	"current_position_ms" integer DEFAULT 0 NOT NULL,
	"eligibility_accepted_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "daily_session_ads" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "daily_ad_views" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"position" integer NOT NULL,
	"status" "daily_ad_view_status" DEFAULT 'pending' NOT NULL,
	"last_position_ms" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"quartiles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"clicked_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "daily_pools" (
	"id" text PRIMARY KEY NOT NULL,
	"pool_date" text NOT NULL,
	"status" "daily_pool_status" DEFAULT 'open' NOT NULL,
	"funds_cents" integer DEFAULT 0 NOT NULL,
	"payout_pool_cents" integer DEFAULT 0 NOT NULL,
	"winner_count" integer DEFAULT 5 NOT NULL,
	"period_starts_at" timestamp with time zone NOT NULL,
	"period_ends_at" timestamp with time zone NOT NULL,
	"draw_at" timestamp with time zone NOT NULL,
	"drawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "daily_pool_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"pool_date" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"status" "daily_entry_status" DEFAULT 'eligible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "daily_winners" (
	"id" text PRIMARY KEY NOT NULL,
	"pool_id" text NOT NULL,
	"pool_date" text NOT NULL,
	"user_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "daily_winner_status" DEFAULT 'approved' NOT NULL,
	"earnings_ledger_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "daily_campaigns" ADD CONSTRAINT "daily_campaigns_advertiser_account_id_advertiser_accounts_id_fk" FOREIGN KEY ("advertiser_account_id") REFERENCES "public"."advertiser_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_sessions" ADD CONSTRAINT "daily_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_session_ads" ADD CONSTRAINT "daily_session_ads_session_id_daily_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."daily_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_session_ads" ADD CONSTRAINT "daily_session_ads_campaign_id_daily_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."daily_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_ad_views" ADD CONSTRAINT "daily_ad_views_session_id_daily_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."daily_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_ad_views" ADD CONSTRAINT "daily_ad_views_campaign_id_daily_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."daily_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_pool_entries" ADD CONSTRAINT "daily_pool_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_pool_entries" ADD CONSTRAINT "daily_pool_entries_session_id_daily_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."daily_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_winners" ADD CONSTRAINT "daily_winners_pool_id_daily_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."daily_pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_winners" ADD CONSTRAINT "daily_winners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_winners" ADD CONSTRAINT "daily_winners_entry_id_daily_pool_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."daily_pool_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_winners" ADD CONSTRAINT "daily_winners_earnings_ledger_id_earnings_ledger_id_fk" FOREIGN KEY ("earnings_ledger_id") REFERENCES "public"."earnings_ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "daily_campaigns_account_idx" ON "daily_campaigns" USING btree ("advertiser_account_id","created_at");--> statement-breakpoint
CREATE INDEX "daily_campaigns_active_idx" ON "daily_campaigns" USING btree ("status","starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_sessions_user_pool_date_idx" ON "daily_sessions" USING btree ("user_id","pool_date");--> statement-breakpoint
CREATE INDEX "daily_sessions_pool_date_idx" ON "daily_sessions" USING btree ("pool_date","status");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_session_ads_position_idx" ON "daily_session_ads" USING btree ("session_id","position");--> statement-breakpoint
CREATE INDEX "daily_session_ads_campaign_idx" ON "daily_session_ads" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_ad_views_position_idx" ON "daily_ad_views" USING btree ("session_id","position");--> statement-breakpoint
CREATE INDEX "daily_ad_views_campaign_created_idx" ON "daily_ad_views" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_pools_pool_date_idx" ON "daily_pools" USING btree ("pool_date");--> statement-breakpoint
CREATE INDEX "daily_pools_draw_idx" ON "daily_pools" USING btree ("status","draw_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_pool_entries_user_pool_date_idx" ON "daily_pool_entries" USING btree ("user_id","pool_date");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_pool_entries_session_idx" ON "daily_pool_entries" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "daily_pool_entries_pool_date_idx" ON "daily_pool_entries" USING btree ("pool_date","status");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_winners_pool_user_idx" ON "daily_winners" USING btree ("pool_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_winners_entry_idx" ON "daily_winners" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "daily_winners_user_created_idx" ON "daily_winners" USING btree ("user_id","created_at");
