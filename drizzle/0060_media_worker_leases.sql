CREATE TABLE IF NOT EXISTS "media_worker_leases" (
  "lane" text NOT NULL,
  "slot" integer NOT NULL,
  "owner_token" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "media_worker_leases_lane_slot_pk" PRIMARY KEY ("lane", "slot")
);
