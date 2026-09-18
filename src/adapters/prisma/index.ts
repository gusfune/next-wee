/**
 * Prisma implementation of `DbAdapter`. The schema is a folder of
 * `.prisma` files, the client is generated into `<src>/db/generated`, and
 * migrations are Prisma folders with a `down.sql` next to `migration.sql`.
 * `db:rollback` does not run: it prints the manual procedure. See
 * docs/database-flow.md for the end-to-end flow.
 */
import { existsSync } from "node:fs"
import { join, relative } from "node:path"
import { format } from "date-fns"
import type {
  Attribute,
  DbAdapter,
  DbProvider,
  InitOptions,
  InitResult,
  MigrationOptions,
  MigrationStatus,
  ModelSpec,
  PrepareResult,
} from "../../core/adapters.js"
import type { FileChange } from "../../core/changes.js"
import { applyChanges, readIfExists } from "../../core/changes.js"
import type { Context } from "../../core/context.js"
import { sourceDir } from "../../core/context.js"
import { WeeError } from "../../core/errors.js"
import { databaseUrl, loadTargetEnv } from "../../lib/env.js"
import { kebabCase, plural } from "../../lib/inflect.js"
import { runBin } from "../../lib/packages.js"
import { createDatabase, dropDatabase, tableExists } from "../driver.js"
import {
  assertPushAllowed,
  assertResetAllowed,
  baseInit,
  createIfMissing,
  createOrReplace,
  databaseName,
  dbDirs,
  hasSeeds,
  provider,
  runSeed,
  sqlShell,
  withDriver,
} from "../shared.js"
import { validatorTemplate, validatorTestTemplate } from "../validator.js"
import { referencedModel } from "./fields.js"
import {
  diffSql,
  generateMigration,
  listMigrations,
  migrationChanges,
  migrationTime,
  STAMP,
} from "./migrations.js"
import { editModelSource } from "./model-edit.js"
import {
  ADAPTER,
  backRelationLine,
  baseSchemaTemplate,
  clientTemplate,
  DEFAULT_URL,
  modelFile,
  modelTemplate,
  prismaConfigTemplate,
  seedRunnerTemplate,
  seedsReadmeTemplate,
  serviceTemplate,
} from "./templates.js"

const MIGRATIONS_TABLE = "_prisma_migrations"

/** Raw drivers wee uses for status, prepare and reset. */
const DRIVER: Record<DbProvider, string> = {
  postgres: "postgres",
  sqlite: "better-sqlite3",
  mysql: "mysql2",
}

const generatedDir = (ctx: Context): string =>
  join(sourceDir(ctx), "db/generated")

const init = async (ctx: Context, opts: InitOptions): Promise<InitResult> => {
  const src = sourceDir(ctx)
  const db = {
    adapter: "prisma" as const,
    provider: opts.provider,
    schemaDir: "db/schema",
    migrationsDir: "db/migrations",
  }
  const paths = {
    src,
    schemaDir: join(src, db.schemaDir),
    migrationsDir: join(src, db.migrationsDir),
    generatedDir: join(src, "db/generated"),
  }
  const defaultUrl = DEFAULT_URL[opts.provider](databaseName(ctx))
  const base = baseInit(ctx, {
    db,
    defaultUrl,
    ignores: [
      ...(opts.provider === "sqlite" ? ["*.sqlite"] : []),
      `${paths.generatedDir}/`,
    ],
  })
  const changes: FileChange[] = [
    ...base.changes,
    ...createIfMissing(
      ctx,
      "prisma.config.ts",
      prismaConfigTemplate({ paths, defaultUrl })
    ),
    ...createIfMissing(
      ctx,
      join(paths.schemaDir, "schema.prisma"),
      baseSchemaTemplate(
        opts.provider,
        relative(paths.schemaDir, paths.generatedDir)
      )
    ),
    ...createIfMissing(
      ctx,
      join(src, "db/client.ts"),
      clientTemplate(opts.provider)
    ),
    ...createIfMissing(ctx, join(src, "db/seed.ts"), seedRunnerTemplate()),
    ...createIfMissing(
      ctx,
      join(src, "db/seeds/README.md"),
      seedsReadmeTemplate()
    ),
  ]
  return {
    changes,
    dependencies: base.missing([
      "@prisma/client",
      ADAPTER[opts.provider].package,
      DRIVER[opts.provider],
      "zod",
      "server-only",
    ]),
    devDependencies: base.missing([
      "prisma",
      ...(ctx.repo.packageManager === "bun" ? [] : ["tsx"]),
    ]),
  }
}

const modelPath = (ctx: Context, model: Pick<ModelSpec, "table">): string =>
  join(dbDirs(ctx).schemaDir, modelFile(model))

const modelTypeImport = (ctx: Context): string =>
  join(generatedDir(ctx), "client.ts")

/** Injects `posts Post[]` into the referenced model of every `references` attribute. */
const backRelations = (
  ctx: Context,
  model: Pick<ModelSpec, "name" | "table">,
  attributes: Attribute[],
  pending: readonly FileChange[] = []
): FileChange[] =>
  attributes
    .filter((attribute) => attribute.references !== undefined)
    .map((attribute) => {
      const table = attribute.references ?? ""
      const path = modelPath(ctx, { table })
      const isPending = pending.some(
        (change) => change.kind !== "delete" && change.path === path
      )
      if (!isPending && !existsSync(join(ctx.target.path, path))) {
        throw new WeeError(
          "model-missing",
          `${model.name}.${attribute.name} references "${table}" but ${path} does not exist. Run "wee g model ${referencedModel(table)}" first.`
        )
      }
      return {
        kind: "inject" as const,
        path,
        marker: `relation-${kebabCase(model.table)}-${kebabCase(attribute.name)}`,
        content: backRelationLine(model.name, model.table),
        // After the last scalar field, before the blank line and `@@map`.
        after: "  updatedAt ",
      }
    })

const emitModel = (
  ctx: Context,
  model: ModelSpec,
  pending: FileChange[] = []
): FileChange[] => [
  {
    kind: "create",
    path: modelPath(ctx, model),
    content: modelTemplate(provider(ctx), model),
  },
  ...backRelations(ctx, model, model.attributes, pending),
]

const emitValidator = (ctx: Context, model: ModelSpec): FileChange[] => {
  const dir = join(sourceDir(ctx), "lib/validators")
  const file = kebabCase(model.name)
  return [
    createOrReplace(ctx, join(dir, `${file}.ts`), validatorTemplate(model)),
    createOrReplace(
      ctx,
      join(dir, `${file}.test.ts`),
      validatorTestTemplate(model)
    ),
  ]
}

const emitService = (ctx: Context, model: ModelSpec): FileChange[] => {
  const src = sourceDir(ctx)
  const path = join(src, "services", `${kebabCase(plural(model.name))}.ts`)
  return [
    createOrReplace(
      ctx,
      path,
      serviceTemplate(model, {
        client: "../db/client",
        generated: "../db/generated/client",
      })
    ),
  ]
}

const emitMigration = async (
  ctx: Context,
  opts: MigrationOptions
): Promise<FileChange[]> => {
  const { name, change } = opts
  const pending = [...opts.pending]
  if (change.kind === "add-columns" || change.kind === "remove-columns") {
    const path = modelPath(ctx, { table: change.table })
    const source = readIfExists(join(ctx.target.path, path))
    if (source === undefined) {
      throw new WeeError(
        "model-missing",
        `No model for table "${change.table}" at ${path}`
      )
    }
    const content = editModelSource({
      provider: provider(ctx),
      table: change.table,
      source,
      add: change.kind === "add-columns" ? change.attributes : [],
      remove: change.kind === "remove-columns" ? change.attributes : [],
    })
    pending.push({ kind: "modify", path, content })
    if (change.kind === "add-columns") {
      pending.push(
        ...backRelations(
          ctx,
          { name: referencedModel(change.table), table: change.table },
          change.attributes
        )
      )
    }
  }
  const migration = await generateMigration({ ctx, name, change, pending })
  return [
    ...pending.filter((item) => !opts.pending.includes(item)),
    ...migration,
  ]
}

/** Runs a prisma CLI command with the app's config and env. */
const prisma = async (ctx: Context, args: string[]): Promise<void> => {
  loadTargetEnv(ctx.target.path)
  await runBin({
    targetPath: ctx.target.path,
    name: "prisma",
    args,
    stdio: ctx.flags.json ? "pipe" : "inherit",
  })
}

/**
 * `db:generate`: diffs the migration history against the schema folder.
 * Prisma replays the history on a shadow database, which it creates by
 * itself for sqlite only.
 */
const generate = async (ctx: Context, name?: string): Promise<void> => {
  loadTargetEnv(ctx.target.path)
  const { migrationsDir, schemaDir } = dbDirs(ctx)
  const target = ctx.target.path
  const history = listMigrations(join(target, migrationsDir))
  const from =
    history.length === 0
      ? { empty: true as const }
      : { migrations: migrationsDir }
  const up = await diffSql({ ctx, from, to: { schema: schemaDir } })
  if (up === undefined) {
    throw new WeeError(
      "no-schema-changes",
      "The schema matches the migration history, nothing to generate"
    )
  }
  const down =
    (await diffSql({ ctx, from: { schema: schemaDir }, to: from })) ?? ""
  // Like drizzle-kit generate, this writes without a manifest: the folder
  // is a migration, not a generator run.
  applyChanges({
    root: target,
    changes: migrationChanges(ctx, {
      folder: `${format(new Date(), STAMP)}_${name ?? "schema_changes"}`,
      up,
      down,
    }),
    dryRun: ctx.flags.dryRun,
  })
}

const migrate = async (ctx: Context): Promise<void> => {
  const { migrationsDir } = dbDirs(ctx)
  if (listMigrations(join(ctx.target.path, migrationsDir)).length === 0) {
    throw new WeeError(
      "no-migrations",
      `${migrationsDir} has no migrations. Run "wee g model" first.`
    )
  }
  await prisma(ctx, ["migrate", "deploy"])
  await prisma(ctx, ["generate"])
}

interface AppliedRow {
  migration_name: string
}

/** Names of the migrations `_prisma_migrations` records as finished. */
const appliedMigrations = async (ctx: Context): Promise<Set<string>> =>
  withDriver(ctx, async (driver) => {
    if (!(await tableExists(driver, provider(ctx), MIGRATIONS_TABLE))) {
      return new Set<string>()
    }
    const rows = await driver.query<AppliedRow>(
      `SELECT migration_name FROM ${MIGRATIONS_TABLE} WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
    )
    return new Set(rows.map((row) => row.migration_name))
  })

const status = async (ctx: Context): Promise<MigrationStatus[]> => {
  const { migrationsDir } = dbDirs(ctx)
  const history = listMigrations(join(ctx.target.path, migrationsDir))
  if (history.length === 0) {
    return []
  }
  const applied = await appliedMigrations(ctx)
  return history.map((name) => ({
    name,
    applied: applied.has(name),
    when: migrationTime(name),
  }))
}

/**
 * Prisma has no down migrations and `migrate resolve --rolled-back` only
 * accepts failed ones, so wee does not run the rollback. It fails with the
 * manual procedure instead.
 */
const rollback = async (ctx: Context, step: number): Promise<string[]> => {
  const { migrationsDir } = dbDirs(ctx)
  const history = listMigrations(join(ctx.target.path, migrationsDir))
  const applied = await appliedMigrations(ctx)
  const targets = [...history]
    .reverse()
    .filter((name) => applied.has(name))
    .slice(0, step)
  if (targets.length === 0) {
    return []
  }
  const steps = targets.flatMap((name) => [
    `npx prisma db execute --file ${join(migrationsDir, name, "down.sql")}`,
    `echo "DELETE FROM ${MIGRATIONS_TABLE} WHERE migration_name = '${name}'" | npx prisma db execute --stdin`,
    `rm -r ${join(migrationsDir, name)}  # or "wee destroy" the generator that wrote it`,
  ])
  throw new WeeError(
    "rollback-manual",
    `Prisma cannot roll back. To reverse ${targets.join(", ")} run, in order:\n${steps.map((line) => `  ${line}`).join("\n")}`,
    { data: { migrations: targets, steps } }
  )
}

const push = async (ctx: Context): Promise<void> => {
  assertPushAllowed()
  await prisma(ctx, ["db", "push", "--accept-data-loss"])
}

const prepare = async (ctx: Context): Promise<PrepareResult> => {
  const url = databaseUrl(ctx.target.path)
  const created = await createDatabase({
    targetPath: ctx.target.path,
    provider: provider(ctx),
    url,
  })
  const fresh =
    created ||
    !(await withDriver(ctx, (driver) =>
      tableExists(driver, provider(ctx), MIGRATIONS_TABLE)
    ))
  const { migrationsDir } = dbDirs(ctx)
  const migrated =
    listMigrations(join(ctx.target.path, migrationsDir)).length > 0
  if (migrated) {
    await migrate(ctx)
  }
  const seeded = fresh && hasSeeds(ctx)
  if (seeded) {
    await runSeed(ctx, { replant: false })
  }
  return { created, migrated, seeded }
}

const reset = async (ctx: Context): Promise<void> => {
  assertResetAllowed()
  await dropDatabase({
    targetPath: ctx.target.path,
    provider: provider(ctx),
    url: databaseUrl(ctx.target.path),
  })
  await prepare(ctx)
}

const studio = async (ctx: Context): Promise<void> => {
  await prisma(ctx, ["studio"])
}

const prismaAdapter: DbAdapter = {
  name: "prisma",
  init,
  modelPath,
  modelTypeImport,
  emitModel,
  emitMigration,
  emitValidator,
  emitService,
  generate,
  migrate,
  rollback,
  status,
  push,
  seed: runSeed,
  prepare,
  reset,
  studio,
  console: sqlShell,
}

export { prismaAdapter }
