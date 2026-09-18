/**
 * Adapter contracts from the spec. Phase 1 implements `DbAdapter` for
 * Drizzle, phase 4 for Prisma and the auth providers. Every `emit*` method
 * is pure and returns FileChanges. The `db:*` methods run external tools.
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
  /** camelCase property name, e.g. `authorId`. */
  name: string
  /** snake_case column name, e.g. `author_id`. */
  column: string
  type: AttributeType
  /** Enum members for `enum[a,b]`. */
  values?: string[]
  /** Referenced table for `references`, e.g. `authors`. */
  references?: string
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

type DbProvider = "postgres" | "sqlite" | "mysql"

interface InitOptions {
  provider: DbProvider
  /** Paths of a setup that exists already. Init then adopts it and writes only what is missing. */
  adopt?: {
    schemaDir: string
    migrationsDir: string
  }
}

interface InitResult {
  changes: FileChange[]
  dependencies: string[]
  devDependencies: string[]
}

/** What a migration does to the schema. Drives model edits and the down SQL. */
type SchemaChange =
  | { kind: "create-table"; model: ModelSpec }
  /** Several tables in one migration, e.g. the auth tables. */
  | { kind: "create-tables"; models: ModelSpec[] }
  | { kind: "add-columns"; table: string; attributes: Attribute[] }
  | { kind: "remove-columns"; table: string; attributes: Attribute[] }
  | { kind: "custom" }

interface MigrationOptions {
  /** snake_case migration name, e.g. `create_posts`. */
  name: string
  change: SchemaChange
  /** Schema changes not yet on disk. The adapter diffs against them. */
  pending: FileChange[]
}

interface MigrationStatus {
  name: string
  applied: boolean
  when: string
}

interface SeedOptions {
  file?: string | undefined
  replant: boolean
}

interface PrepareResult {
  created: boolean
  migrated: boolean
  seeded: boolean
}

interface DbAdapter {
  readonly name: "drizzle" | "prisma"
  init(ctx: Context, opts: InitOptions): Promise<InitResult>
  /** Schema file of a model, relative to the target, e.g. `src/db/schema/posts.ts`. */
  modelPath(ctx: Context, model: ModelSpec): string
  /** Module that exports the model's row type (`Post`), relative to the target. */
  modelTypeImport(ctx: Context, model: ModelSpec): string
  /** `pending` lists changes of the same run, so a reference to a model created in it resolves. */
  emitModel(
    ctx: Context,
    model: ModelSpec,
    pending?: FileChange[]
  ): FileChange[]
  emitMigration(ctx: Context, opts: MigrationOptions): Promise<FileChange[]>
  emitValidator(ctx: Context, model: ModelSpec): FileChange[]
  emitService(ctx: Context, model: ModelSpec): FileChange[]
  generate(ctx: Context, name?: string): Promise<void>
  migrate(ctx: Context): Promise<void>
  /** Returns the names of the migrations it reversed. */
  rollback(ctx: Context, step: number): Promise<string[]>
  status(ctx: Context): Promise<MigrationStatus[]>
  push(ctx: Context): Promise<void>
  seed(ctx: Context, opts: SeedOptions): Promise<void>
  prepare(ctx: Context): Promise<PrepareResult>
  reset(ctx: Context): Promise<void>
  studio(ctx: Context): Promise<void>
  console(ctx: Context): Promise<void>
}

export type {
  Attribute,
  AttributeType,
  DbAdapter,
  DbProvider,
  InitOptions,
  InitResult,
  MigrationOptions,
  MigrationStatus,
  ModelSpec,
  PrepareResult,
  SchemaChange,
  SeedOptions,
}
