import { config } from "dotenv"

import { defineConfig } from "drizzle-kit"

config({ path: ".env.local" })
config()

export default defineConfig({
  out: "./drizzle",
  schema: "./lib/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
})
