CREATE TYPE "public"."advertiser_account_status" AS ENUM('active', 'paused', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."advertiser_member_role" AS ENUM('owner', 'admin', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."advertiser_wallet_transaction_status" AS ENUM('pending', 'posted', 'failed', 'void');--> statement-breakpoint
CREATE TYPE "public"."advertiser_wallet_transaction_type" AS ENUM('funding', 'reserve', 'capture', 'release', 'refund', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."brand_funding_profile_status" AS ENUM('draft', 'active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."brand_funding_target_kind" AS ENUM('brand_name', 'handle', 'keyword', 'hashtag', 'domain', 'product', 'exclusion');--> statement-breakpoint
CREATE TYPE "public"."brand_match_event_status" AS ENUM('pending', 'qualified', 'rejected', 'charged', 'paid');--> statement-breakpoint
CREATE TABLE "advertiser_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"website_url" text,
	"billing_email" text NOT NULL,
	"status" "advertiser_account_status" DEFAULT 'active' NOT NULL,
	"stripe_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advertiser_members" (
	"advertiser_account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "advertiser_member_role" DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advertiser_members_pkey" PRIMARY KEY("advertiser_account_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "advertiser_wallet_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"advertiser_account_id" text NOT NULL,
	"type" "advertiser_wallet_transaction_type" NOT NULL,
	"status" "advertiser_wallet_transaction_status" DEFAULT 'pending' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"description" text,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "brand_funding_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"advertiser_account_id" text NOT NULL,
	"status" "brand_funding_profile_status" DEFAULT 'draft' NOT NULL,
	"display_name" text NOT NULL,
	"approval_mode" text DEFAULT 'auto' NOT NULL,
	"daily_cap_cents" integer,
	"monthly_cap_cents" integer,
	"allowed_categories" text,
	"blocked_categories" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_funding_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"kind" "brand_funding_target_kind" NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_match_events" (
	"id" text PRIMARY KEY NOT NULL,
	"advertiser_account_id" text NOT NULL,
	"funding_profile_id" text NOT NULL,
	"story_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"matched_target_id" text,
	"status" "brand_match_event_status" DEFAULT 'pending' NOT NULL,
	"confidence" numeric(5, 2) DEFAULT '0',
	"system_priced_amount_cents" integer,
	"wallet_transaction_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "advertiser_accounts" ADD CONSTRAINT "advertiser_accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_members" ADD CONSTRAINT "advertiser_members_advertiser_account_id_advertiser_accounts_id_fk" FOREIGN KEY ("advertiser_account_id") REFERENCES "public"."advertiser_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_members" ADD CONSTRAINT "advertiser_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_wallet_transactions" ADD CONSTRAINT "advertiser_wallet_transactions_advertiser_account_id_advertiser_accounts_id_fk" FOREIGN KEY ("advertiser_account_id") REFERENCES "public"."advertiser_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_funding_profiles" ADD CONSTRAINT "brand_funding_profiles_advertiser_account_id_advertiser_accounts_id_fk" FOREIGN KEY ("advertiser_account_id") REFERENCES "public"."advertiser_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_funding_targets" ADD CONSTRAINT "brand_funding_targets_profile_id_brand_funding_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."brand_funding_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_match_events" ADD CONSTRAINT "brand_match_events_advertiser_account_id_advertiser_accounts_id_fk" FOREIGN KEY ("advertiser_account_id") REFERENCES "public"."advertiser_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_match_events" ADD CONSTRAINT "brand_match_events_funding_profile_id_brand_funding_profiles_id_fk" FOREIGN KEY ("funding_profile_id") REFERENCES "public"."brand_funding_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_match_events" ADD CONSTRAINT "brand_match_events_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_match_events" ADD CONSTRAINT "brand_match_events_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_match_events" ADD CONSTRAINT "brand_match_events_matched_target_id_brand_funding_targets_id_fk" FOREIGN KEY ("matched_target_id") REFERENCES "public"."brand_funding_targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_match_events" ADD CONSTRAINT "brand_match_events_wallet_transaction_id_advertiser_wallet_transactions_id_fk" FOREIGN KEY ("wallet_transaction_id") REFERENCES "public"."advertiser_wallet_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advertiser_accounts_owner_user_id_idx" ON "advertiser_accounts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "advertiser_accounts_stripe_customer_id_idx" ON "advertiser_accounts" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "advertiser_members_user_id_idx" ON "advertiser_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "advertiser_wallet_account_idx" ON "advertiser_wallet_transactions" USING btree ("advertiser_account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "advertiser_wallet_stripe_session_idx" ON "advertiser_wallet_transactions" USING btree ("stripe_checkout_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "advertiser_wallet_stripe_payment_intent_idx" ON "advertiser_wallet_transactions" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE INDEX "brand_funding_profiles_account_idx" ON "brand_funding_profiles" USING btree ("advertiser_account_id","created_at");--> statement-breakpoint
CREATE INDEX "brand_funding_targets_profile_idx" ON "brand_funding_targets" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_funding_targets_unique_idx" ON "brand_funding_targets" USING btree ("profile_id","kind","value");--> statement-breakpoint
CREATE INDEX "brand_match_events_account_idx" ON "brand_match_events" USING btree ("advertiser_account_id","created_at");--> statement-breakpoint
CREATE INDEX "brand_match_events_story_idx" ON "brand_match_events" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "brand_match_events_creator_idx" ON "brand_match_events" USING btree ("creator_id","created_at");