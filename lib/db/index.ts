import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"

import { env } from "@/lib/env"

import * as schema from "./schema"

const globalForDatabase = globalThis as {
  database?: ReturnType<typeof createDatabase>
}

function createDatabase() {
  const client = neon(env.DATABASE_URL)

  return drizzle(client, { schema })
}

export function getDb() {
  if (!globalForDatabase.database) {
    globalForDatabase.database = createDatabase()
  }

  return globalForDatabase.database
}
