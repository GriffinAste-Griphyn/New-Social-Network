import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

const connectionString = process.env.DATABASE_URL?.trim()

if (!connectionString) {
  console.error("DATABASE_URL is required to run database migrations.")
  process.exit(1)
}

const client = postgres(connectionString, {
  max: 1,
  prepare: false,
  connect_timeout: 15,
  idle_timeout: 5,
})

function describeError(error) {
  if (!(error instanceof Error)) {
    return { message: String(error) }
  }

  return {
    name: error.name,
    message: error.message,
    code: error.code,
    detail: error.detail,
    hint: error.hint,
    schema: error.schema_name,
    table: error.table_name,
    column: error.column_name,
    constraint: error.constraint_name,
    cause: error.cause ? describeError(error.cause) : undefined,
  }
}

try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" })
  console.log("Database migrations applied successfully.")
} catch (error) {
  console.error("Database migration failed:", describeError(error))
  process.exitCode = 1
} finally {
  await client.end({ timeout: 5 })
}
