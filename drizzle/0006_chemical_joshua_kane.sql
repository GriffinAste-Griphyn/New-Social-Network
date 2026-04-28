CREATE TYPE "public"."story_interaction_kind" AS ENUM('reply', 'comment', 'reaction');--> statement-breakpoint
CREATE TABLE "story_interactions" (
	"id" text PRIMARY KEY NOT NULL,
	"story_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"kind" "story_interaction_kind" NOT NULL,
	"body" text,
	"reaction" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story_interactions" ADD CONSTRAINT "story_interactions_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_interactions" ADD CONSTRAINT "story_interactions_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_interactions" ADD CONSTRAINT "story_interactions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_interactions_story_id_idx" ON "story_interactions" USING btree ("story_id","created_at");--> statement-breakpoint
CREATE INDEX "story_interactions_creator_id_idx" ON "story_interactions" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "story_interactions_actor_id_idx" ON "story_interactions" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "story_interactions_kind_idx" ON "story_interactions" USING btree ("kind","created_at");