CREATE TYPE "public"."creator_status" AS ENUM('inactive', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."user_onboarding_intent" AS ENUM('explore', 'create', 'both');--> statement-breakpoint
CREATE TABLE "creator_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"category" text,
	"creator_bio" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"analytics_enabled" boolean DEFAULT true NOT NULL,
	"monetization_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "is_creator_mode" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_intent" "user_onboarding_intent" DEFAULT 'explore' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "creator_status" "creator_status" DEFAULT 'inactive' NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "users" SET "onboarding_intent" = 'both', "creator_status" = 'active' WHERE "is_creator_mode" = true;--> statement-breakpoint
INSERT INTO "creator_profiles" ("user_id") SELECT "id" FROM "users" WHERE "creator_status" = 'active' ON CONFLICT DO NOTHING;
