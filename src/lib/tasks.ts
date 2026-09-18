/**
 * Runners behind lint, typecheck, test, test:e2e, build, dev and start.
 * Each runner resolves its tool from the target app and runs it there,
 * returning the exit code so `ci` can stop at the first failure. In a
 * Turborepo whose turbo.json defines the task, the run goes through
 * `turbo run <task> --filter=<app>` so caching and dependencies apply.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { getDbAdapter } from "../adapters/index.js"
import { writeFile } from "../core/changes.js"
import type { Context } from "../core/context.js"
import { WeeError } from "../core/errors.js"
import { playwrightConfigTemplate } from "../templates/ops.js"
import type { RunToolResult } from "./packages.js"
import { runTool } from "./packages.js"

type Stdio = "inherit" | "pipe"

interface TaskOptions {
  ctx: Context
  stdio: Stdio
}

type TurboTask = "dev" | "build" | "test" | "lint"

/** True when turbo.json defines the task and the target is a workspace, not the root. */
const delegatesToTurbo = (ctx: Context, task: TurboTask): boolean =>
  ctx.repo.hasTurbo &&
  ctx.repo.turboTasks.includes(task) &&
  ctx.target.path !== ctx.repo.root

const runTurbo = (
  options: TaskOptions,
  task: TurboTask,
  extra: string[] = []
): Promise<RunToolResult> =>
  runTool({
    targetPath: options.ctx.repo.root,
    name: "turbo",
    args: ["run", task, `--filter=${options.ctx.target.name}`, ...extra],
    stdio: options.stdio,
  })

const runNext = (
  options: TaskOptions,
  args: string[]
): Promise<RunToolResult> =>
  runTool({
    targetPath: options.ctx.target.path,
    name: "next",
    args,
    stdio: options.stdio,
  })

const BIOME_FILES = ["biome.json", "biome.jsonc"]
const ESLINT_FILES = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yml",
  ".eslintrc.yaml",
]

type Linter = "biome" | "eslint"

/** Biome or ESLint, whichever config the target or the repo root has. */
const detectLinter = (ctx: Context): Linter => {
  const dirs = [ctx.target.path, ctx.repo.root]
  const has = (files: string[]): boolean =>
    dirs.some((dir) => files.some((file) => existsSync(join(dir, file))))
  if (has(BIOME_FILES)) {
    return "biome"
  }
  if (has(ESLINT_FILES)) {
    return "eslint"
  }
  throw new WeeError(
    "linter-missing",
    `No biome.json or ESLint config in ${ctx.target.path} or ${ctx.repo.root}. Add one; "wee new" writes biome.json.`
  )
}

const lint = async (options: TaskOptions): Promise<RunToolResult> => {
  if (delegatesToTurbo(options.ctx, "lint")) {
    return runTurbo(options, "lint")
  }
  const linter = detectLinter(options.ctx)
  return runTool({
    targetPath: options.ctx.target.path,
    name: linter === "biome" ? "@biomejs/biome" : "eslint",
    bin: linter,
    // `biome lint`, not `check`: generated code is not run through the
    // formatter, and formatting is not a lint failure.
    args: linter === "biome" ? ["lint", "."] : ["."],
    stdio: options.stdio,
  })
}

/** `next typegen` writes the route types, then `tsc --noEmit` checks the app. */
const typecheck = async (options: TaskOptions): Promise<RunToolResult> => {
  const { ctx } = options
  if (ctx.target.kind === "app") {
    const typegen = await runNext(options, ["typegen"])
    if (typegen.exitCode !== 0) {
      return typegen
    }
  }
  return runTool({
    targetPath: ctx.target.path,
    name: "typescript",
    bin: "tsc",
    args: ["--noEmit", "-p", "."],
    stdio: options.stdio,
  })
}

interface TestOptions extends TaskOptions {
  path?: string | undefined
  watch: boolean
}

const test = async (options: TestOptions): Promise<RunToolResult> => {
  const { path, watch } = options
  if (path === undefined && !watch && delegatesToTurbo(options.ctx, "test")) {
    return runTurbo(options, "test")
  }
  return runTool({
    targetPath: options.ctx.target.path,
    name: "vitest",
    args: [watch ? "watch" : "run", ...(path === undefined ? [] : [path])],
    stdio: options.stdio,
  })
}

const PLAYWRIGHT_CONFIG = "playwright.config.ts"
const PLAYWRIGHT_PACKAGE = "@playwright/test"

/** `db:prepare` when the app has a database, then Playwright over `e2e/`. */
const prepareDatabase = async (ctx: Context): Promise<void> => {
  if (ctx.config.db !== undefined) {
    await getDbAdapter(ctx).prepare(ctx)
  }
}

interface E2eOptions extends TaskOptions {
  headed: boolean
}

interface E2eResult extends RunToolResult {
  /** Set when the run wrote the missing Playwright config. */
  wroteConfig: boolean
}

const testE2e = async (options: E2eOptions): Promise<E2eResult> => {
  const { ctx, headed } = options
  const config = join(ctx.target.path, PLAYWRIGHT_CONFIG)
  const wroteConfig = !existsSync(config)
  if (wroteConfig) {
    writeFile(config, playwrightConfigTemplate(ctx.repo.packageManager))
  }
  await prepareDatabase(ctx)
  const result = await runTool({
    targetPath: ctx.target.path,
    name: PLAYWRIGHT_PACKAGE,
    bin: "playwright",
    args: ["test", ...(headed ? ["--headed"] : [])],
    stdio: options.stdio,
  })
  return { ...result, wroteConfig }
}

/** `typecheck` first: `next build` reports type errors late and one file at a time. */
const build = async (options: TaskOptions): Promise<RunToolResult> => {
  const checked = await typecheck(options)
  if (checked.exitCode !== 0) {
    return checked
  }
  if (delegatesToTurbo(options.ctx, "build")) {
    return runTurbo(options, "build")
  }
  return runNext(options, ["build"])
}

interface ServeOptions extends TaskOptions {
  port: string | undefined
}

const portArgs = (port: string | undefined): string[] =>
  port === undefined ? [] : ["--port", port]

/** `db:prepare`, then `next dev`. */
const dev = async (options: ServeOptions): Promise<RunToolResult> => {
  const { ctx, port } = options
  await prepareDatabase(ctx)
  if (delegatesToTurbo(ctx, "dev")) {
    return runTurbo(options, "dev", ["--", ...portArgs(port)])
  }
  return runNext(options, ["dev", ...portArgs(port)])
}

const start = (options: ServeOptions): Promise<RunToolResult> =>
  runNext(options, ["start", ...portArgs(options.port)])

export type { E2eResult, RunToolResult as TaskResult, Stdio }
export {
  build,
  delegatesToTurbo,
  detectLinter,
  dev,
  lint,
  PLAYWRIGHT_CONFIG,
  start,
  test,
  testE2e,
  typecheck,
}
