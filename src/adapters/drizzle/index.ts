/**
 * Drizzle implementation of `DbAdapter`. Emitters return FileChanges from
 * the templates. The `db:*` methods wrap drizzle-kit and, for what
 * drizzle-kit does not do (rollback, status, prepare, reset), use the raw
 * driver. See docs/database-flow.md for the end-to-end flow.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { x } from "tinyexec"
import type {
  DbAdapter,
  DbProvider,
  InitOptions,
  InitResult,
  MigrationOptions,
  MigrationStatus,
  ModelSpec,
  PrepareResult,
  SeedOptions,
} from "../../core/adapters.js"
import type { FileChange } from "../../core/changes.js"
import {
  createOrReplace as createOrReplaceChange,
  readIfExists,
} from "../../core/changes.js"
import { CONFIG_DIR, CONFIG_FILE } from "../../core/config.js"
import type { Context } from "../../core/context.js"
import { sourceDir } from "../../core/context.js"
import { WeeError } from "../../core/errors.js"
import { appEnv, databaseUrl, loadTargetEnv } from "../../lib/env.js"
import { kebabCase, plural } from "../../lib/inflect.js"
import { packageBin, runBin } from "../../lib/packages.js"
import {
  appliedMigrations,
  createDatabase,
  databaseTarget,
  dropDatabase,
  forgetMigration,
  migrationsTableExists,
  openDriver,
} from "./driver.js"
import {
  assertMigrationsHaveSql,
  dbDirs,
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
  validatorTemplate,
  validatorTestTemplate,
} from "./templates.js"

const DRIVER: Record<DbProvider, string> = {
  postgres: "postgres",
  sqlite: "better-sqlite3",
  mysql: "mysql2",
}

const DB_SCRIPTS = [
  "db:generate",
  "db:migrate",
  "db:rollback",
  "db:status",
  "db:push",
  "db:seed",
  "db:prepare",
  "db:reset",
  "db:studio",
]

const provider = (ctx: Context): DbProvider =>
  ctx.config.db?.provider ?? "postgres"

/** Indentation of an existing JSON file, so a rewrite keeps its style. */
const detectIndent = (text: string): string =>
  text.match(/^(\s+)"/m)?.[1] ?? "  "

/** `create` for a new file, `modify` with `--force` when it exists. */
const createOrReplace = (
  ctx: Context,
  path: string,
  content: string
): FileChange =>
  createOrReplaceChange({
    root: ctx.target.path,
    force: ctx.flags.force,
    path,
    content,
  })

const init = async (ctx: Context, opts: InitOptions): Promise<InitResult> => {
  const src = sourceDir(ctx)
  const target = ctx.target.path
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
  const configPath = join(CONFIG_DIR, CONFIG_FILE)
  const existingConfig = readIfExists(join(target, configPath))
  const config = {
    ...(existingConfig === undefined
      ? { router: ctx.config.router, srcDir: ctx.config.srcDir }
      : (JSON.parse(existingConfig) as Record<string, unknown>)),
    db,
  }
  const pkgPath = join(target, "package.json")
  const pkgText = readFileSync(pkgPath, "utf8")
  const pkg = JSON.parse(pkgText) as {
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const scripts = { ...pkg.scripts }
  for (const script of DB_SCRIPTS) {
    scripts[script] = `wee ${script}`
  }
  const appName = kebabCase(
    ctx.target.name === "root" ? "app" : ctx.target.name
  ).replace(/-/g, "_")
  // Files that already exist are kept as they are. That is what makes
  // adopting an existing Drizzle setup safe; on a fresh app nothing exists.
  const createIfMissing = (path: string, content: string): FileChange[] =>
    existsSync(join(target, path)) ? [] : [{ kind: "create", path, content }]
  const changes: FileChange[] = [
    {
      kind: existingConfig === undefined ? "create" : "modify",
      path: configPath,
      content: `${JSON.stringify(config, null, 2)}\n`,
    },
    ...createIfMissing(
      "drizzle.config.ts",
      drizzleConfigTemplate(opts.provider, paths)
    ),
    ...createIfMissing(
      join(src, "db/client.ts"),
      clientTemplate(opts.provider)
    ),
    ...createIfMissing(
      join(paths.schemaDir, "index.ts"),
      schemaIndexTemplate()
    ),
    ...createIfMissing(join(src, "db/seed.ts"), seedRunnerTemplate()),
    ...createIfMissing(join(src, "db/seeds/README.md"), seedsReadmeTemplate()),
    {
      kind: "modify",
      path: "package.json",
      content: `${JSON.stringify({ ...pkg, scripts }, null, detectIndent(pkgText))}\n`,
    },
  ]
  if (
    !(readIfExists(join(target, ".env.example")) ?? "").includes(
      "DATABASE_URL="
    )
  ) {
    changes.push({
      kind: "inject",
      path: ".env.example",
      marker: "db",
      content: `DATABASE_URL=${DEFAULT_URL[opts.provider](appName)}`,
    })
  }
  if (
    opts.provider === "sqlite" &&
    !(readIfExists(join(target, ".gitignore")) ?? "").includes("*.sqlite")
  ) {
    changes.push({
      kind: "inject",
      path: ".gitignore",
      marker: "db",
      content: "*.sqlite",
    })
  }
  const missing = (names: string[]): string[] =>
    names.filter(
      (name) =>
        pkg.dependencies?.[name] === undefined &&
        pkg.devDependencies?.[name] === undefined
    )
  return {
    changes,
    dependencies: missing([
      "drizzle-orm",
      DRIVER[opts.provider],
      "zod",
      "server-only",
    ]),
    devDependencies: missing([
      "drizzle-kit",
      ...(ctx.repo.packageManager === "bun" ? [] : ["tsx"]),
    ]),
  }
}

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

const withDriver = async <T>(
  ctx: Context,
  fn: (driver: Awaited<ReturnType<typeof openDriver>>) => Promise<T>
): Promise<T> => {
  const driver = await openDriver({
    targetPath: ctx.target.path,
    provider: provider(ctx),
    url: databaseUrl(ctx.target.path),
  })
  try {
    return await fn(driver)
  } finally {
    await driver.close()
  }
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
  const env = appEnv()
  if (env !== "local" && env !== "preview") {
    throw new WeeError(
      "push-refused",
      `db:push is allowed in local and preview only (APP_ENV=${env})`
    )
  }
  await kit(ctx, ["push", "--force"])
}

const seed = async (ctx: Context, opts: SeedOptions): Promise<void> => {
  loadTargetEnv(ctx.target.path)
  const runner = join(sourceDir(ctx), "db/seed.ts")
  if (!existsSync(join(ctx.target.path, runner))) {
    throw new WeeError(
      "seed-runner-missing",
      `${runner} is missing. Run "wee db:init" first.`
    )
  }
  const args = [
    ...(opts.file === undefined ? [] : ["--file", opts.file]),
    ...(opts.replant ? ["--replant"] : []),
  ]
  const useBun = ctx.repo.packageManager === "bun"
  const command = useBun ? "bun" : "node"
  const commandArgs = useBun
    ? [runner, ...args]
    : [packageBin(ctx.target.path, "tsx"), runner, ...args]
  const result = await x(command, commandArgs, {
    nodeOptions: {
      cwd: ctx.target.path,
      stdio: ctx.flags.json ? "pipe" : "inherit",
    },
    throwOnError: false,
  })
  if (result.exitCode !== 0) {
    throw new WeeError("seed-failed", "Seeding failed", {
      exitCode: result.exitCode ?? 1,
      data: { stdout: result.stdout, stderr: result.stderr },
    })
  }
}

/** True when `db/seeds` holds at least one seed module. */
const hasSeeds = (ctx: Context): boolean => {
  const dir = join(ctx.target.path, sourceDir(ctx), "db/seeds")
  return (
    existsSync(dir) && readdirSync(dir).some((file) => file.endsWith(".ts"))
  )
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
    await seed(ctx, { replant: false })
  }
  return { created, migrated, seeded }
}

const reset = async (ctx: Context): Promise<void> => {
  if (appEnv() === "production") {
    throw new WeeError(
      "reset-refused",
      "db:reset refuses to run when APP_ENV is production"
    )
  }
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

const consoleCommand = async (ctx: Context): Promise<void> => {
  const url = databaseUrl(ctx.target.path)
  const p = provider(ctx)
  const [command, args] = ((): [string, string[]] => {
    switch (p) {
      case "postgres":
        return ["psql", [url]]
      case "sqlite":
        return ["sqlite3", [join(ctx.target.path, databaseTarget(p, url).name)]]
      case "mysql": {
        const parsed = new URL(url)
        return [
          "mysql",
          [
            `--host=${parsed.hostname}`,
            ...(parsed.port.length > 0 ? [`--port=${parsed.port}`] : []),
            `--user=${decodeURIComponent(parsed.username)}`,
            ...(parsed.password.length > 0
              ? [`--password=${decodeURIComponent(parsed.password)}`]
              : []),
            databaseTarget(p, url).name,
          ],
        ]
      }
    }
  })()
  const result = await x(command, args, {
    nodeOptions: { cwd: ctx.target.path, stdio: "inherit" },
    throwOnError: false,
  })
  if (result.exitCode !== 0) {
    throw new WeeError(
      "console-failed",
      `${command} exited with ${result.exitCode ?? "unknown"}`
    )
  }
}

const drizzleAdapter: DbAdapter = {
  name: "drizzle",
  init,
  emitModel,
  emitMigration,
  emitValidator,
  emitService,
  generate,
  migrate,
  rollback,
  status,
  push,
  seed,
  prepare,
  reset,
  studio,
  console: consoleCommand,
}

export { drizzleAdapter }
