CREATE TABLE "creator_notification_preferences" (
	"subscriber_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_notification_preferences_pkey" PRIMARY KEY("subscriber_id","creator_id")
);
--> statement-breakpoint
CREATE TABLE "mobile_push_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expo_push_token" text NOT NULL,
	"platform" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creator_notification_preferences" ADD CONSTRAINT "creator_notification_preferences_subscriber_id_users_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_notification_preferences" ADD CONSTRAINT "creator_notification_preferences_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_push_tokens" ADD CONSTRAINT "mobile_push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_notifications_subscriber_idx" ON "creator_notification_preferences" USING btree ("subscriber_id","updated_at");--> statement-breakpoint
CREATE INDEX "creator_notifications_creator_idx" ON "creator_notification_preferences" USING btree ("creator_id","updated_at");--> statement-breakpoint
CREATE INDEX "mobile_push_tokens_user_idx" ON "mobile_push_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_push_tokens_token_idx" ON "mobile_push_tokens" USING btree ("expo_push_token");