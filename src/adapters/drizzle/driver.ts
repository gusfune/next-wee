/**
 * Raw SQL access for `db:status`, `db:rollback`, `db:prepare` and
 * `db:reset`. Loads the driver the app already has (postgres,
 * better-sqlite3 or mysql2) from the target's node_modules. Only the
 * handful of queries these commands need go through here; everything else
 * is delegated to drizzle-kit.
 */
import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { DbProvider } from "../../core/adapters.js"
import { WeeError } from "../../core/errors.js"
import { importFromTarget } from "../../lib/packages.js"

interface SqlDriver {
  exec(sql: string): Promise<void>
  query<T>(sql: string, params?: unknown[]): Promise<T[]>
  close(): Promise<void>
}

interface PostgresSql {
  unsafe(query: string, params?: unknown[]): Promise<unknown[]>
  end(): Promise<void>
}
type PostgresFactory = (
  url: string,
  options: Record<string, unknown>
) => PostgresSql

interface SqliteStatement {
  all(...params: unknown[]): unknown[]
}
interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}
type SqliteFactory = new (file: string) => SqliteDatabase

interface MysqlConnection {
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>
  end(): Promise<void>
}
interface MysqlModule {
  createConnection(options: Record<string, unknown>): Promise<MysqlConnection>
}

const noop = (): void => undefined

interface OpenOptions {
  targetPath: string
  provider: DbProvider
  url: string
}

const openDriver = async (options: OpenOptions): Promise<SqlDriver> => {
  const { targetPath, provider, url } = options
  switch (provider) {
    case "postgres": {
      const mod = await importFromTarget<{ default: PostgresFactory }>(
        targetPath,
        "postgres"
      )
      const sql = mod.default(url, { max: 1, onnotice: noop })
      return {
        exec: async (text) => {
          await sql.unsafe(text)
        },
        query: async <T>(text: string, params: unknown[] = []) =>
          (await sql.unsafe(text, params)) as T[],
        close: () => sql.end(),
      }
    }
    case "sqlite": {
      const mod = await importFromTarget<{ default: SqliteFactory }>(
        targetPath,
        "better-sqlite3"
      )
      const db = new mod.default(url)
      return {
        exec: async (text) => db.exec(text),
        query: async <T>(text: string, params: unknown[] = []) =>
          db.prepare(text).all(...params) as T[],
        close: async () => db.close(),
      }
    }
    case "mysql": {
      const mod = await importFromTarget<MysqlModule>(
        targetPath,
        "mysql2/promise"
      )
      const connection = await mod.createConnection({
        uri: url,
        multipleStatements: true,
      })
      return {
        exec: async (text) => {
          await connection.query(text)
        },
        query: async <T>(text: string, params: unknown[] = []) =>
          (await connection.query(text, params))[0] as T[],
        close: () => connection.end(),
      }
    }
  }
}

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

const migrationsTableExists = async (
  driver: SqlDriver,
  provider: DbProvider
): Promise<boolean> => {
  const sql = ((): string => {
    switch (provider) {
      case "postgres":
        return "SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'"
      case "sqlite":
        return "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'"
      case "mysql":
        return "SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '__drizzle_migrations'"
    }
  })()
  const rows = await driver.query(sql)
  return rows.length > 0
}

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

interface DatabaseTarget {
  /** Connection URL to the maintenance database (postgres, mysql) or the file (sqlite). */
  adminUrl: string
  name: string
}

/** Splits a URL into the server connection and the database name. */
const databaseTarget = (provider: DbProvider, url: string): DatabaseTarget => {
  if (provider === "sqlite") {
    return { adminUrl: url, name: url }
  }
  const parsed = new URL(url)
  const name = parsed.pathname.replace(/^\//, "")
  if (name.length === 0) {
    throw new WeeError(
      "database-url-invalid",
      `DATABASE_URL has no database name: ${url}`
    )
  }
  parsed.pathname = provider === "postgres" ? "/postgres" : "/"
  return { adminUrl: parsed.toString(), name }
}

interface AdminOptions {
  targetPath: string
  provider: DbProvider
  url: string
}

/** Creates the database when it is missing. Returns true when it created it. */
const createDatabase = async (options: AdminOptions): Promise<boolean> => {
  const { targetPath, provider, url } = options
  const { adminUrl, name } = databaseTarget(provider, url)
  if (provider === "sqlite") {
    return !existsSync(join(targetPath, name))
  }
  const driver = await openDriver({ targetPath, provider, url: adminUrl })
  try {
    if (provider === "postgres") {
      const rows = await driver.query(
        "SELECT 1 AS ok FROM pg_database WHERE datname = $1",
        [name]
      )
      if (rows.length > 0) {
        return false
      }
      await driver.exec(`CREATE DATABASE "${name}"`)
      return true
    }
    const rows = await driver.query(
      "SELECT 1 AS ok FROM information_schema.schemata WHERE schema_name = ?",
      [name]
    )
    if (rows.length > 0) {
      return false
    }
    await driver.exec(`CREATE DATABASE \`${name}\``)
    return true
  } finally {
    await driver.close()
  }
}

const dropDatabase = async (options: AdminOptions): Promise<void> => {
  const { targetPath, provider, url } = options
  const { adminUrl, name } = databaseTarget(provider, url)
  if (provider === "sqlite") {
    rmSync(join(targetPath, name), { force: true })
    return
  }
  const driver = await openDriver({ targetPath, provider, url: adminUrl })
  try {
    await driver.exec(
      provider === "postgres"
        ? `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`
        : `DROP DATABASE IF EXISTS \`${name}\``
    )
  } finally {
    await driver.close()
  }
}

export type { SqlDriver }
export {
  appliedMigrations,
  createDatabase,
  databaseTarget,
  dropDatabase,
  forgetMigration,
  migrationsTableExists,
  openDriver,
}
