ALTER TABLE "mobile_push_tokens" ADD COLUMN "apns_device_token" text;--> statement-breakpoint
ALTER TABLE "mobile_push_tokens" ADD COLUMN "push_provider" text DEFAULT 'expo' NOT NULL;--> statement-breakpoint
ALTER TABLE "mobile_push_tokens" ADD COLUMN "apns_environment" text;--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_push_tokens_apns_token_idx" ON "mobile_push_tokens" USING btree ("apns_device_token");
