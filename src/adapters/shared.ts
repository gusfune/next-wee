/**
 * Pieces every `DbAdapter` shares: the config and package.json edits of
 * `db:init`, the seed runner invocation, the environment guards of
 * `db:push` and `db:reset`, and the SQL shell of `db:console`. Adapters
 * add their own files and tool calls on top.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { x } from "tinyexec"
import type { DbProvider, SeedOptions } from "../core/adapters.js"
import type { FileChange } from "../core/changes.js"
import {
  createOrReplace as createOrReplaceChange,
  readIfExists,
} from "../core/changes.js"
import type { AppConfig } from "../core/config.js"
import { configChange } from "../core/config.js"
import type { Context } from "../core/context.js"
import { appSlug, sourceDir } from "../core/context.js"
import { WeeError } from "../core/errors.js"
import { appEnv, databaseUrl, loadTargetEnv } from "../lib/env.js"
import { missingPackages, runScript } from "../lib/packages.js"
import type { SqlDriver } from "./driver.js"
import { databaseTarget, openDriver } from "./driver.js"

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

interface DbDirs {
  /** Relative to the target app. */
  schemaDir: string
  migrationsDir: string
}

const dbDirs = (ctx: Context): DbDirs => {
  const db = ctx.config.db
  if (db === undefined) {
    throw new WeeError(
      "db-not-initialised",
      'No database adapter. Run "wee db:init" first.'
    )
  }
  const src = sourceDir(ctx)
  return {
    schemaDir: join(src, db.schemaDir),
    migrationsDir: join(src, db.migrationsDir),
  }
}

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

/** Files that already exist are kept as they are, so adopting a setup is safe. */
const createIfMissing = (
  ctx: Context,
  path: string,
  content: string
): FileChange[] =>
  existsSync(join(ctx.target.path, path))
    ? []
    : [{ kind: "create", path, content }]

/** snake_case app name for a default database name, e.g. `my_app_local`. */
const databaseName = (ctx: Context): string => appSlug(ctx).replace(/-/g, "_")

interface PackageJson {
  scripts?: Record<string, string>
}

interface BaseInitOptions {
  db: NonNullable<AppConfig["db"]>
  /** Default `DATABASE_URL` for `.env.example`. */
  defaultUrl: string
  /** Extra `.gitignore` lines, e.g. a generated client directory. */
  ignores: string[]
}

interface BaseInit {
  changes: FileChange[]
  /** Package names from the list that package.json does not have yet. */
  missing: (names: string[]) => string[]
}

/** Config, package.json scripts, `.env.example` and `.gitignore` edits of `db:init`. */
const baseInit = (ctx: Context, options: BaseInitOptions): BaseInit => {
  const { db, defaultUrl, ignores } = options
  const target = ctx.target.path
  const pkgText = readFileSync(join(target, "package.json"), "utf8")
  const pkg = JSON.parse(pkgText) as PackageJson
  const scripts = { ...pkg.scripts }
  for (const script of DB_SCRIPTS) {
    scripts[script] = `wee ${script}`
  }
  const changes: FileChange[] = [
    configChange({ targetPath: target, current: ctx.config, patch: { db } }),
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
      content: `DATABASE_URL=${defaultUrl}`,
    })
  }
  const gitignore = readIfExists(join(target, ".gitignore")) ?? ""
  const newIgnores = ignores.filter((line) => !gitignore.includes(line))
  if (newIgnores.length > 0) {
    changes.push({
      kind: "inject",
      path: ".gitignore",
      marker: "db",
      content: newIgnores.join("\n"),
    })
  }
  const missing = (names: string[]): string[] => missingPackages(target, names)
  return { changes, missing }
}

const withDriver = async <T>(
  ctx: Context,
  fn: (driver: SqlDriver) => Promise<T>
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

/** Runs `<src>/db/seed.ts` with the seed flags. */
const runSeed = async (ctx: Context, opts: SeedOptions): Promise<void> => {
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
  const result = await runScript({
    ctx,
    script: runner,
    args,
    stdio: ctx.flags.json ? "pipe" : "inherit",
  })
  if (result.exitCode !== 0) {
    throw new WeeError("seed-failed", "Seeding failed", {
      exitCode: result.exitCode,
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

const assertPushAllowed = (): void => {
  const env = appEnv()
  if (env !== "local" && env !== "preview") {
    throw new WeeError(
      "push-refused",
      `db:push is allowed in local and preview only (APP_ENV=${env})`
    )
  }
}

const assertResetAllowed = (): void => {
  if (appEnv() === "production") {
    throw new WeeError(
      "reset-refused",
      "db:reset refuses to run when APP_ENV is production"
    )
  }
}

/** Opens psql, sqlite3 or mysql on the configured database. */
const sqlShell = async (ctx: Context): Promise<void> => {
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

export type { DbDirs }
export {
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
}
