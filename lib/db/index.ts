import { neonConfig, Pool } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-serverless"

import { env } from "@/lib/env"

import * as schema from "./schema"

const globalForDatabase = globalThis as {
  database?: ReturnType<typeof createDatabase>
  databasePool?: Pool
}

neonConfig.poolQueryViaFetch = true
neonConfig.fetchEndpoint = (host) => `https://${host}/sql`

function createDatabase() {
  globalForDatabase.databasePool ??= new Pool({
    connectionString: process.env.DATABASE_REPLICA_URL?.trim() || env.DATABASE_URL,
    // Each Vercel function instance owns its own pool. Keeping the per-instance
    // pool small prevents a burst of warm instances from exhausting Neon's
    // connection permits even when DATABASE_URL points at the pooled endpoint.
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  })

  // Idle WebSocket failures are emitted by the pool. Without a listener Node
  // treats them as uncaught exceptions and terminates the Vercel function.
  globalForDatabase.databasePool.on("error", (error: Error) => {
    console.error("database_pool_error", error)
  })

  return drizzle(globalForDatabase.databasePool, { schema })
}

export function getDb() {
  if (!globalForDatabase.database) {
    globalForDatabase.database = createDatabase()
  }

  return globalForDatabase.database
}
