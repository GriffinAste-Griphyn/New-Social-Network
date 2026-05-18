import { Pool } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-serverless"

import { env } from "@/lib/env"

import * as schema from "./schema"

const globalForDatabase = globalThis as {
  database?: ReturnType<typeof createDatabase>
  databasePool?: Pool
}

function createDatabase() {
  globalForDatabase.databasePool ??= new Pool({
    connectionString: env.DATABASE_URL,
  })

  return drizzle(globalForDatabase.databasePool, { schema })
}

export function getDb() {
  if (!globalForDatabase.database) {
    globalForDatabase.database = createDatabase()
  }

  return globalForDatabase.database
}
