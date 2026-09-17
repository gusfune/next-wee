/**
 * Adapter contracts from the spec. Phase 1 implements `DbAdapter` for
 * Drizzle, phase 4 for Prisma and the auth providers. Types only here so
 * later phases build against a fixed shape.
 */
import type { FileChange } from "./changes.js"
import type { Context } from "./context.js"

type AttributeType =
  | "string"
  | "text"
  | "integer"
  | "decimal"
  | "boolean"
  | "datetime"
  | "uuid"
  | "json"
  | "enum"
  | "references"

interface Attribute {
  name: string
  type: AttributeType
  /** Enum members for `enum[a,b]`. */
  values?: string[]
  unique: boolean
  index: boolean
  optional: boolean
  defaultValue?: string
}

interface ModelSpec {
  /** PascalCase singular, e.g. `Post`. */
  name: string
  /** snake_case plural table name, e.g. `posts`. */
  table: string
  attributes: Attribute[]
}

interface InitOptions {
  provider: "postgres" | "sqlite" | "mysql"
  force: boolean
}

interface MigrationStatus {
  name: string
  applied: boolean
  appliedAt?: string
}

interface DbAdapter {
  readonly name: "drizzle" | "prisma"
  init(ctx: Context, opts: InitOptions): Promise<FileChange[]>
  emitModel(ctx: Context, model: ModelSpec): Promise<FileChange[]>
  emitMigration(ctx: Context, name: string): Promise<FileChange[]>
  emitValidator(ctx: Context, model: ModelSpec): Promise<FileChange[]>
  emitService(ctx: Context, model: ModelSpec): Promise<FileChange[]>
  migrate(ctx: Context): Promise<void>
  rollback(ctx: Context, step: number): Promise<void>
  status(ctx: Context): Promise<MigrationStatus[]>
  push(ctx: Context): Promise<void>
  studio(ctx: Context): Promise<void>
}

export type {
  Attribute,
  AttributeType,
  DbAdapter,
  InitOptions,
  MigrationStatus,
  ModelSpec,
}
