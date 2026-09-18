/**
 * `wee console [--sandbox]` and `wee runner <file|expr>`. Both spawn
 * `runtime/preload` inside the target app with `db`, `schema`, `services`
 * and `auth` in scope. The console is a Node REPL; the runner evaluates
 * one expression or file and exits with 1 when it throws or yields false.
 */
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { defineWeeCommand } from "../core/command.js"
import type { Context } from "../core/context.js"
import { assertAppRouter, sourceDir } from "../core/context.js"
import { WeeError } from "../core/errors.js"
import { loadTargetEnv } from "../lib/env.js"
import { packageDir, runScript } from "../lib/packages.js"
import { runtimeScript } from "../lib/runtime.js"

interface PreloadOptions {
  ctx: Context
  /** Mode and file or expression flags for the preload. */
  args: string[]
  /** Console and runner need a database; a task runs without one. */
  requireDb: boolean
}

const runPreload = async (options: PreloadOptions): Promise<void> => {
  const { ctx, args, requireDb } = options
  assertAppRouter(ctx)
  const db = ctx.config.db
  if (db === undefined && requireDb) {
    throw new WeeError(
      "db-required",
      `${ctx.target.name} has no database. Run "wee db:init" first.`
    )
  }
  loadTargetEnv(ctx.target.path)
  const src = join(ctx.target.path, sourceDir(ctx))
  const dbArgs: string[] = []
  if (db !== undefined) {
    // Generated services import "server-only"; the react-server condition
    // makes it resolve, but the package itself must be installed.
    packageDir(ctx.target.path, "server-only")
    dbArgs.push(
      "--schema",
      join(src, db.schemaDir),
      "--provider",
      db.provider,
      "--adapter",
      db.adapter
    )
  }
  const result = await runScript({
    ctx,
    script: runtimeScript("preload"),
    args: ["--app", ctx.target.path, "--src", src, ...dbArgs, ...args],
    stdio: "inherit",
    conditions: ["react-server"],
  })
  process.exitCode = result.exitCode
}

const consoleCommand = defineWeeCommand({
  meta: {
    name: "console",
    description: "REPL with db, schema, services and auth in scope",
  },
  args: {
    sandbox: {
      type: "boolean",
      description: "Open a transaction and roll it back on exit",
      default: false,
    },
  },
  run: async (ctx, args) => {
    await runPreload({
      ctx,
      args: ["--mode", "console", ...(args.sandbox ? ["--sandbox"] : [])],
      requireDb: true,
    })
    return undefined
  },
})

const runner = defineWeeCommand({
  meta: {
    name: "runner",
    description: "Evaluate a file or expression with the app loaded",
  },
  args: {
    target: {
      type: "positional",
      description: "Script path, or an expression when no such file exists",
      required: true,
    },
    sandbox: {
      type: "boolean",
      description: "Open a transaction and roll it back at the end",
      default: false,
    },
  },
  run: async (ctx, args) => {
    const file = resolve(ctx.cwd, args.target)
    await runPreload({
      ctx,
      args: [
        "--mode",
        "runner",
        ...(existsSync(file) ? ["--file", file] : ["--expr", args.target]),
        ...(args.sandbox ? ["--sandbox"] : []),
      ],
      requireDb: true,
    })
    return undefined
  },
})

export { consoleCommand, runner, runPreload }
