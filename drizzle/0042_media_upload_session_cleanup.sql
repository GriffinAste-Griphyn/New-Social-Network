CREATE INDEX IF NOT EXISTS "media_upload_sessions_cleanup_expiry_idx"
	ON "media_upload_sessions" USING btree ("status", "expires_at");

CREATE INDEX IF NOT EXISTS "media_upload_sessions_cleanup_consumed_idx"
	ON "media_upload_sessions" USING btree ("status", "consumed_at");
