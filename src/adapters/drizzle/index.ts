/**
 * Drizzle implementation of `DbAdapter`. Emitters return FileChanges from
 * the templates. The `db:*` methods wrap drizzle-kit and, for what
 * drizzle-kit does not do (rollback, status, prepare, reset), use the raw
 * driver. See docs/database-flow.md for the end-to-end flow.
 */
import { join, relative } from "node:path"
import type {
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
import { readIfExists } from "../../core/changes.js"
import type { Context } from "../../core/context.js"
import { sourceDir } from "../../core/context.js"
import { WeeError } from "../../core/errors.js"
import { databaseUrl, loadTargetEnv } from "../../lib/env.js"
import { kebabCase, plural } from "../../lib/inflect.js"
import { runBin } from "../../lib/packages.js"
import { createDatabase, dropDatabase } from "../driver.js"
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
import {
  appliedMigrations,
  forgetMigration,
  migrationsTableExists,
} from "./driver.js"
import {
  assertMigrationsHaveSql,
  generateMigration,
  readDownStatements,
  readJournal,
} from "./migrations.js"
import { editModelSource } from "./model-edit.js"
import {
  clientTemplate,
  DEFAULT_URL,
  drizzleConfigTemplate,
  modelFile,
  modelTemplate,
  schemaIndexTemplate,
  seedRunnerTemplate,
  seedsReadmeTemplate,
  serviceTemplate,
} from "./templates.js"

const DRIVER: Record<DbProvider, string> = {
  postgres: "postgres",
  sqlite: "better-sqlite3",
  mysql: "mysql2",
}

const init = async (ctx: Context, opts: InitOptions): Promise<InitResult> => {
  const src = sourceDir(ctx)
  // Config paths are relative to the source dir; adopted paths are relative to the app.
  const db = {
    adapter: "drizzle" as const,
    provider: opts.provider,
    schemaDir:
      opts.adopt === undefined
        ? "db/schema"
        : relative(src, opts.adopt.schemaDir),
    migrationsDir:
      opts.adopt === undefined
        ? "db/migrations"
        : relative(src, opts.adopt.migrationsDir),
  }
  const paths = {
    src,
    schemaDir: join(src, db.schemaDir),
    migrationsDir: join(src, db.migrationsDir),
  }
  const base = baseInit(ctx, {
    db,
    defaultUrl: DEFAULT_URL[opts.provider](databaseName(ctx)),
    ignores: opts.provider === "sqlite" ? ["*.sqlite"] : [],
  })
  const changes: FileChange[] = [
    ...base.changes,
    ...createIfMissing(
      ctx,
      "drizzle.config.ts",
      drizzleConfigTemplate(opts.provider, paths)
    ),
    ...createIfMissing(
      ctx,
      join(src, "db/client.ts"),
      clientTemplate(opts.provider)
    ),
    ...createIfMissing(
      ctx,
      join(paths.schemaDir, "index.ts"),
      schemaIndexTemplate()
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
      "drizzle-orm",
      DRIVER[opts.provider],
      "zod",
      "server-only",
    ]),
    devDependencies: base.missing([
      "drizzle-kit",
      ...(ctx.repo.packageManager === "bun" ? [] : ["tsx"]),
    ]),
  }
}

const modelPath = (ctx: Context, model: ModelSpec): string =>
  join(dbDirs(ctx).schemaDir, modelFile(model))

const emitModel = (ctx: Context, model: ModelSpec): FileChange[] => {
  const { schemaDir } = dbDirs(ctx)
  const file = modelFile(model)
  return [
    {
      kind: "create",
      path: join(schemaDir, file),
      content: modelTemplate(provider(ctx), model),
    },
    {
      kind: "inject",
      path: join(schemaDir, "index.ts"),
      marker: `model-${kebabCase(model.name)}`,
      content: `export * from "./${file.replace(/\.ts$/, "")}"`,
    },
  ]
}

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
  const path = join(
    sourceDir(ctx),
    "services",
    `${kebabCase(plural(model.name))}.ts`
  )
  return [createOrReplace(ctx, path, serviceTemplate(provider(ctx), model))]
}

const emitMigration = async (
  ctx: Context,
  opts: MigrationOptions
): Promise<FileChange[]> => {
  const { name, change } = opts
  const pending = [...opts.pending]
  if (change.kind === "add-columns" || change.kind === "remove-columns") {
    const { schemaDir } = dbDirs(ctx)
    const path = join(schemaDir, `${kebabCase(change.table)}.ts`)
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
  }
  const migration = await generateMigration({
    ctx,
    provider: provider(ctx),
    name,
    change,
    pending,
  })
  return [
    ...pending.filter((item) => !opts.pending.includes(item)),
    ...migration,
  ]
}

/** Runs a drizzle-kit command with the app's config and env. */
const kit = async (
  ctx: Context,
  args: string[],
  stdio: "inherit" | "pipe" = "inherit"
): Promise<void> => {
  loadTargetEnv(ctx.target.path)
  await runBin({
    targetPath: ctx.target.path,
    name: "drizzle-kit",
    args: [...args, "--config", "drizzle.config.ts"],
    stdio: ctx.flags.json ? "pipe" : stdio,
  })
}

const generate = async (ctx: Context, name?: string): Promise<void> => {
  await kit(ctx, ["generate", ...(name === undefined ? [] : ["--name", name])])
}

const migrate = async (ctx: Context): Promise<void> => {
  const { migrationsDir } = dbDirs(ctx)
  const dir = join(ctx.target.path, migrationsDir)
  if (readJournal(dir) === undefined) {
    throw new WeeError(
      "no-migrations",
      `${migrationsDir} has no migrations. Run "wee g model" first.`
    )
  }
  assertMigrationsHaveSql(dir)
  await kit(ctx, ["migrate"])
}

const status = async (ctx: Context): Promise<MigrationStatus[]> => {
  const { migrationsDir } = dbDirs(ctx)
  const journal = readJournal(join(ctx.target.path, migrationsDir))
  if (journal === undefined) {
    return []
  }
  const applied = new Set(
    await withDriver(ctx, (driver) => appliedMigrations(driver, provider(ctx)))
  )
  return journal.entries.map((entry) => ({
    name: entry.tag,
    applied: applied.has(entry.when),
    when: new Date(entry.when).toISOString(),
  }))
}

const rollback = async (ctx: Context, step: number): Promise<string[]> => {
  const { migrationsDir } = dbDirs(ctx)
  const dir = join(ctx.target.path, migrationsDir)
  const journal = readJournal(dir)
  if (journal === undefined) {
    return []
  }
  return withDriver(ctx, async (driver) => {
    const applied = new Set(await appliedMigrations(driver, provider(ctx)))
    const targets = [...journal.entries]
      .reverse()
      .filter((entry) => applied.has(entry.when))
      .slice(0, step)
    const rolledBack: string[] = []
    for (const entry of targets) {
      const statements = readDownStatements(dir, entry.tag)
      // One transaction per migration. MySQL auto-commits DDL, so there a
      // failed down file can leave the schema half reverted.
      await driver.exec("BEGIN")
      try {
        for (const statement of statements) {
          await driver.exec(statement)
        }
        await forgetMigration(driver, provider(ctx), entry.when)
        await driver.exec("COMMIT")
      } catch (error) {
        await driver.exec("ROLLBACK")
        throw error
      }
      rolledBack.push(entry.tag)
    }
    return rolledBack
  })
}

const push = async (ctx: Context): Promise<void> => {
  assertPushAllowed()
  await kit(ctx, ["push", "--force"])
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
      migrationsTableExists(driver, provider(ctx))
    ))
  const { migrationsDir } = dbDirs(ctx)
  const migrated =
    readJournal(join(ctx.target.path, migrationsDir)) !== undefined
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
  const url = databaseUrl(ctx.target.path)
  await dropDatabase({
    targetPath: ctx.target.path,
    provider: provider(ctx),
    url,
  })
  await prepare(ctx)
}

const studio = async (ctx: Context): Promise<void> => {
  await kit(ctx, ["studio"])
}

const drizzleAdapter: DbAdapter = {
  name: "drizzle",
  init,
  modelPath,
  modelTypeImport: modelPath,
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

export { drizzleAdapter }
