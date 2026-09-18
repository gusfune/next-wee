/**
 * Type maps for the Drizzle adapter: attribute type to Drizzle column
 * builder, to raw SQL type (for down migrations) and to Zod schema. One
 * table per provider so the three dialects stay side by side.
 */
import type { Attribute, DbProvider } from "../../core/adapters.js"
import { camelCase } from "../../lib/inflect.js"
import { quoteIdentifier } from "../driver.js"
import { enumName, isNumeric, quoteLiteral } from "../validator.js"

const CORE_MODULE: Record<DbProvider, string> = {
  postgres: "drizzle-orm/pg-core",
  sqlite: "drizzle-orm/sqlite-core",
  mysql: "drizzle-orm/mysql-core",
}

const TABLE_FN: Record<DbProvider, string> = {
  postgres: "pgTable",
  sqlite: "sqliteTable",
  mysql: "mysqlTable",
}

const KIT_DIALECT: Record<DbProvider, string> = {
  postgres: "postgresql",
  sqlite: "sqlite",
  mysql: "mysql",
}

/** Default clause. `now` on a datetime and `random` on a uuid map to builder helpers. */
const defaultCode = (provider: DbProvider, attribute: Attribute): string => {
  const value = attribute.defaultValue
  if (value === undefined) {
    return ""
  }
  if (attribute.type === "datetime" && value === "now") {
    return provider === "sqlite"
      ? ".$defaultFn(() => new Date())"
      : ".defaultNow()"
  }
  if (attribute.type === "uuid" && value === "random") {
    return provider === "postgres"
      ? ".defaultRandom()"
      : ".$defaultFn(() => crypto.randomUUID())"
  }
  if (
    isNumeric(attribute) ||
    attribute.type === "boolean" ||
    attribute.type === "json"
  ) {
    return `.default(${value})`
  }
  return `.default(${quoteLiteral(value)})`
}

interface ColumnCode {
  code: string
  /** Names to import from the provider's core module. */
  imports: string[]
}

const baseColumn = (
  provider: DbProvider,
  table: string,
  attribute: Attribute
): ColumnCode => {
  const col = quoteLiteral(attribute.column)
  const values = (attribute.values ?? []).map(quoteLiteral).join(", ")
  switch (provider) {
    case "postgres": {
      switch (attribute.type) {
        case "string":
          return {
            code: `varchar(${col}, { length: 255 })`,
            imports: ["varchar"],
          }
        case "text":
          return { code: `text(${col})`, imports: ["text"] }
        case "integer":
          return { code: `integer(${col})`, imports: ["integer"] }
        case "decimal":
          return { code: `numeric(${col})`, imports: ["numeric"] }
        case "boolean":
          return { code: `boolean(${col})`, imports: ["boolean"] }
        case "datetime":
          return {
            code: `timestamp(${col}, { withTimezone: true })`,
            imports: ["timestamp"],
          }
        case "uuid":
        case "references":
          return { code: `uuid(${col})`, imports: ["uuid"] }
        case "json":
          return { code: `jsonb(${col})`, imports: ["jsonb"] }
        case "enum":
          return {
            code: `${enumName(table, attribute).variable}(${col})`,
            imports: ["pgEnum"],
          }
      }
      break
    }
    case "sqlite": {
      switch (attribute.type) {
        case "string":
        case "text":
        case "uuid":
        case "references":
          return { code: `text(${col})`, imports: ["text"] }
        case "integer":
          return { code: `integer(${col})`, imports: ["integer"] }
        case "decimal":
          return { code: `real(${col})`, imports: ["real"] }
        case "boolean":
          return {
            code: `integer(${col}, { mode: "boolean" })`,
            imports: ["integer"],
          }
        case "datetime":
          return {
            code: `integer(${col}, { mode: "timestamp_ms" })`,
            imports: ["integer"],
          }
        case "json":
          return { code: `text(${col}, { mode: "json" })`, imports: ["text"] }
        case "enum":
          return {
            code: `text(${col}, { enum: [${values}] })`,
            imports: ["text"],
          }
      }
      break
    }
    case "mysql": {
      switch (attribute.type) {
        case "string":
          return {
            code: `varchar(${col}, { length: 255 })`,
            imports: ["varchar"],
          }
        case "text":
          return { code: `text(${col})`, imports: ["text"] }
        case "integer":
          return { code: `int(${col})`, imports: ["int"] }
        case "decimal":
          return {
            code: `decimal(${col}, { precision: 12, scale: 2 })`,
            imports: ["decimal"],
          }
        case "boolean":
          return { code: `boolean(${col})`, imports: ["boolean"] }
        case "datetime":
          return { code: `datetime(${col})`, imports: ["datetime"] }
        case "uuid":
        case "references":
          return {
            code: `varchar(${col}, { length: 36 })`,
            imports: ["varchar"],
          }
        case "json":
          return { code: `json(${col})`, imports: ["json"] }
        case "enum":
          return {
            code: `mysqlEnum(${col}, [${values}])`,
            imports: ["mysqlEnum"],
          }
      }
    }
  }
}

/** Full column builder chain for one attribute, e.g. `varchar("title", { length: 255 }).notNull()`. */
const columnCode = (
  provider: DbProvider,
  table: string,
  attribute: Attribute
): ColumnCode => {
  const base = baseColumn(provider, table, attribute)
  const parts = [base.code]
  if (!attribute.optional) {
    parts.push(".notNull()")
  }
  if (attribute.unique) {
    parts.push(".unique()")
  }
  parts.push(defaultCode(provider, attribute))
  if (attribute.type === "references" && attribute.references !== undefined) {
    parts.push(
      `.references(() => ${camelCase(attribute.references)}.id, { onDelete: "restrict" })`
    )
  }
  return { code: parts.join(""), imports: base.imports }
}

/** Primary key and timestamp columns shared by every model. */
const systemColumns = (
  provider: DbProvider
): { id: ColumnCode; createdAt: ColumnCode; updatedAt: ColumnCode } => {
  switch (provider) {
    case "postgres":
      return {
        id: {
          code: 'uuid("id").primaryKey().defaultRandom()',
          imports: ["uuid"],
        },
        createdAt: {
          code: 'timestamp("created_at", { withTimezone: true }).notNull().defaultNow()',
          imports: ["timestamp"],
        },
        updatedAt: {
          code: 'timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date())',
          imports: ["timestamp"],
        },
      }
    case "sqlite":
      return {
        id: {
          code: 'text("id").primaryKey().$defaultFn(() => crypto.randomUUID())',
          imports: ["text"],
        },
        createdAt: {
          code: 'integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date())',
          imports: ["integer"],
        },
        updatedAt: {
          code: 'integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date())',
          imports: ["integer"],
        },
      }
    case "mysql":
      return {
        id: {
          code: 'varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID())',
          imports: ["varchar"],
        },
        createdAt: {
          code: 'timestamp("created_at").notNull().defaultNow()',
          imports: ["timestamp"],
        },
        updatedAt: {
          code: 'timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date())',
          imports: ["timestamp"],
        },
      }
  }
}

const sqlLiteral = (attribute: Attribute, value: string): string =>
  isNumeric(attribute) || attribute.type === "boolean"
    ? value
    : `'${value.replace(/'/g, "''")}'`

/** Raw SQL type used when a down migration re-adds a removed column. */
const sqlType = (
  provider: DbProvider,
  table: string,
  attribute: Attribute
): string => {
  const values = (attribute.values ?? [])
    .map((value) => `'${value}'`)
    .join(", ")
  switch (provider) {
    case "postgres": {
      const map: Record<Attribute["type"], string> = {
        string: "varchar(255)",
        text: "text",
        integer: "integer",
        decimal: "numeric",
        boolean: "boolean",
        datetime: "timestamp with time zone",
        uuid: "uuid",
        json: "jsonb",
        enum: quoteIdentifier(provider, enumName(table, attribute).sqlName),
        references: "uuid",
      }
      return map[attribute.type]
    }
    case "sqlite": {
      const map: Record<Attribute["type"], string> = {
        string: "text",
        text: "text",
        integer: "integer",
        decimal: "real",
        boolean: "integer",
        datetime: "integer",
        uuid: "text",
        json: "text",
        enum: "text",
        references: "text",
      }
      return map[attribute.type]
    }
    case "mysql": {
      const map: Record<Attribute["type"], string> = {
        string: "varchar(255)",
        text: "text",
        integer: "int",
        decimal: "decimal(12, 2)",
        boolean: "boolean",
        datetime: "datetime",
        uuid: "varchar(36)",
        json: "json",
        enum: `enum(${values})`,
        references: "varchar(36)",
      }
      return map[attribute.type]
    }
  }
}

/** `ADD COLUMN` clause body for a down migration that restores a removed column. */
const columnDefinitionSql = (
  provider: DbProvider,
  table: string,
  attribute: Attribute
): string => {
  const parts = [
    quoteIdentifier(provider, attribute.column),
    sqlType(provider, table, attribute),
  ]
  if (attribute.defaultValue !== undefined) {
    parts.push(`DEFAULT ${sqlLiteral(attribute, attribute.defaultValue)}`)
  }
  if (!attribute.optional) {
    parts.push("NOT NULL")
  }
  // SQLite gets its unique index in a separate statement (see downSql).
  if (attribute.unique && provider !== "sqlite") {
    parts.push("UNIQUE")
  }
  return parts.join(" ")
}

export type { ColumnCode }
export {
  CORE_MODULE,
  columnCode,
  columnDefinitionSql,
  KIT_DIALECT,
  systemColumns,
  TABLE_FN,
}
