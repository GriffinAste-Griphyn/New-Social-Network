ALTER TABLE "email_verification_tokens" ADD COLUMN "code_hash" text;--> statement-breakpoint
CREATE INDEX "email_verification_tokens_code_hash_idx" ON "email_verification_tokens" USING btree ("code_hash");
