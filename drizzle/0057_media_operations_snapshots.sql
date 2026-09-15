CREATE TABLE "media_operations_snapshots" (
  "window_end" timestamp with time zone PRIMARY KEY NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "segments" jsonb NOT NULL,
  "pipeline" jsonb NOT NULL,
  "alerts" jsonb NOT NULL,
  "collected_at" timestamp with time zone DEFAULT now() NOT NULL
);
