CREATE TYPE "public"."story_element_kind" AS ENUM('text', 'sticker', 'link');--> statement-breakpoint
CREATE TABLE "story_elements" (
	"id" text PRIMARY KEY NOT NULL,
	"story_id" text NOT NULL,
	"kind" "story_element_kind" NOT NULL,
	"label" text NOT NULL,
	"href" text,
	"position_x" numeric(5, 2) DEFAULT '50',
	"position_y" numeric(5, 2) DEFAULT '74',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story_elements" ADD CONSTRAINT "story_elements_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_elements_story_id_idx" ON "story_elements" USING btree ("story_id","created_at");