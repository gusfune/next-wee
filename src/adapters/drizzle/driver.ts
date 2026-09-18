/**
 * Queries on drizzle's own migrations table, for `db:status` and
 * `db:rollback`. The connection comes from the shared driver.
 */
import type { DbProvider } from "../../core/adapters.js"
import { WeeError } from "../../core/errors.js"
import type { SqlDriver } from "../driver.js"
import { tableExists } from "../driver.js"

/** Fully qualified name of drizzle's migrations table for the provider. */
const migrationsTable = (provider: DbProvider): string => {
  switch (provider) {
    case "postgres":
      return '"drizzle"."__drizzle_migrations"'
    case "sqlite":
      return '"__drizzle_migrations"'
    case "mysql":
      return "`__drizzle_migrations`"
  }
}

const migrationsTableExists = (
  driver: SqlDriver,
  provider: DbProvider
): Promise<boolean> =>
  tableExists(
    driver,
    provider,
    provider === "postgres"
      ? "drizzle.__drizzle_migrations"
      : "__drizzle_migrations"
  )

/** `created_at` of every applied migration. It equals the journal `when`. */
const appliedMigrations = async (
  driver: SqlDriver,
  provider: DbProvider
): Promise<number[]> => {
  if (!(await migrationsTableExists(driver, provider))) {
    return []
  }
  const rows = await driver.query<{ created_at: number | string }>(
    `SELECT created_at FROM ${migrationsTable(provider)} ORDER BY created_at`
  )
  return rows.map((row) => Number(row.created_at))
}

/** Removes the applied row. `when` is a journal timestamp, so it is inlined as a number. */
const forgetMigration = async (
  driver: SqlDriver,
  provider: DbProvider,
  when: number
): Promise<void> => {
  if (!Number.isSafeInteger(when)) {
    throw new WeeError(
      "journal-invalid",
      `Journal entry has a non-integer "when": ${String(when)}`
    )
  }
  await driver.exec(
    `DELETE FROM ${migrationsTable(provider)} WHERE created_at = ${when}`
  )
}

export { appliedMigrations, forgetMigration, migrationsTableExists }
