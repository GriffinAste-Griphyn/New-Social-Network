CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'active', 'paused', 'closed');--> statement-breakpoint
CREATE TYPE "public"."mention_type" AS ENUM('tag', 'text', 'detected');--> statement-breakpoint
CREATE TYPE "public"."payout_source" AS ENUM('brand_match', 'ad_share', 'manual_adjustment');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'approved', 'paid', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."story_asset_kind" AS ENUM('image', 'video');--> statement-breakpoint
CREATE TYPE "public"."story_status" AS ENUM('processing', 'live', 'expired', 'removed');--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"payout_model" text NOT NULL,
	"budget_cents" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_scores" (
	"creator_id" text PRIMARY KEY NOT NULL,
	"freshness_score" numeric(6, 3) DEFAULT '0' NOT NULL,
	"affinity_score" numeric(6, 3) DEFAULT '0' NOT NULL,
	"quality_score" numeric(6, 3) DEFAULT '0' NOT NULL,
	"monetization_score" numeric(6, 3) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "earnings_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source" "payout_source" NOT NULL,
	"source_id" text NOT NULL,
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"amount_cents" integer NOT NULL,
	"available_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_impressions" (
	"id" text PRIMARY KEY NOT NULL,
	"viewer_id" text NOT NULL,
	"story_id" text NOT NULL,
	"score" numeric(8, 4) NOT NULL,
	"rank" integer NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"viewed_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"asset_kind" "story_asset_kind" NOT NULL,
	"media_url" text NOT NULL,
	"thumbnail_url" text,
	"caption" text,
	"duration_ms" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "story_status" DEFAULT 'processing' NOT NULL,
	"brand_signal_score" numeric(5, 2) DEFAULT '0',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_campaign_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"story_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"matched_by" text NOT NULL,
	"estimated_payout_cents" integer DEFAULT 0 NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"story_id" text NOT NULL,
	"brand_slug" text NOT NULL,
	"mention_type" "mention_type" NOT NULL,
	"confidence" numeric(5, 2) DEFAULT '0',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"auth_provider" text DEFAULT 'credentials' NOT NULL,
	"auth_user_id" text,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text,
	"avatar_url" text,
	"is_creator_mode" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creator_scores" ADD CONSTRAINT "creator_scores_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earnings_ledger" ADD CONSTRAINT "earnings_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_impressions" ADD CONSTRAINT "feed_impressions_viewer_id_users_id_fk" FOREIGN KEY ("viewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_impressions" ADD CONSTRAINT "feed_impressions_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_campaign_matches" ADD CONSTRAINT "story_campaign_matches_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_campaign_matches" ADD CONSTRAINT "story_campaign_matches_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_mentions" ADD CONSTRAINT "story_mentions_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle_idx" ON "users" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_user_id_idx" ON "users" USING btree ("auth_user_id");