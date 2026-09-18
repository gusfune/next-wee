/**
 * Raw SQL access shared by the adapters, for what their tools do not do:
 * `db:status`, `db:rollback`, `db:prepare` and `db:reset`. Loads the
 * driver the app already has (postgres, better-sqlite3 or mysql2) from the
 * target's node_modules.
 */
import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { DbProvider } from "../core/adapters.js"
import { WeeError } from "../core/errors.js"
import { importFromTarget } from "../lib/packages.js"

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

/** Path of a sqlite database. Prisma URLs carry a `file:` scheme, Drizzle ones do not. */
const sqliteFile = (url: string): string => url.replace(/^file:/, "")

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
      const db = new mod.default(sqliteFile(url))
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

/** Quotes a table or column name in the provider's dialect. */
const quoteIdentifier = (provider: DbProvider, name: string): string =>
  provider === "mysql" ? `\`${name}\`` : `"${name}"`

/** True when a table with this name exists in the connected database. */
const tableExists = async (
  driver: SqlDriver,
  provider: DbProvider,
  table: string
): Promise<boolean> => {
  const [sql, params] = ((): [string, unknown[]] => {
    switch (provider) {
      case "postgres":
        return [
          "SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2",
          table.includes(".") ? table.split(".") : ["public", table],
        ]
      case "sqlite":
        return [
          "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?",
          [table],
        ]
      case "mysql":
        return [
          "SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
          [table],
        ]
    }
  })()
  const rows = await driver.query(sql, params)
  return rows.length > 0
}

interface DatabaseTarget {
  /** Connection URL to the maintenance database (postgres, mysql) or the file (sqlite). */
  adminUrl: string
  name: string
}

/** Splits a URL into the server connection and the database name. */
const databaseTarget = (provider: DbProvider, url: string): DatabaseTarget => {
  if (provider === "sqlite") {
    const file = sqliteFile(url)
    return { adminUrl: file, name: file }
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
  createDatabase,
  databaseTarget,
  dropDatabase,
  openDriver,
  quoteIdentifier,
  tableExists,
}
