/**
 * `wee console [--sandbox]` and `wee runner <file|expr>`. Both spawn
 * `runtime/preload` inside the target app with `db`, `schema`, `services`
 * and `auth` in scope. The console is a Node REPL; the runner evaluates
 * one expression or file and exits with 1 when it throws or yields false.
 */
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineWeeCommand } from "../core/command.js"
import type { Context } from "../core/context.js"
import { assertAppRouter, sourceDir } from "../core/context.js"
import { WeeError } from "../core/errors.js"
import { loadTargetEnv } from "../lib/env.js"
import { packageDir, runScript } from "../lib/packages.js"

/** Built preload next to the bundle, else the source file under `src/`. */
const preloadPath = (): string => {
  const built = fileURLToPath(new URL("./runtime/preload.js", import.meta.url))
  return existsSync(built)
    ? built
    : fileURLToPath(new URL("../runtime/preload.ts", import.meta.url))
}

const runPreload = async (ctx: Context, extra: string[]): Promise<void> => {
  assertAppRouter(ctx)
  const db = ctx.config.db
  if (db === undefined) {
    throw new WeeError(
      "db-required",
      `${ctx.target.name} has no database. Run "wee db:init" first.`
    )
  }
  // Generated services import "server-only"; the react-server condition
  // makes it resolve, but the package itself must be installed.
  packageDir(ctx.target.path, "server-only")
  loadTargetEnv(ctx.target.path)
  const src = join(ctx.target.path, sourceDir(ctx))
  const result = await runScript({
    ctx,
    script: preloadPath(),
    args: [
      "--app",
      ctx.target.path,
      "--src",
      src,
      "--schema",
      join(src, db.schemaDir),
      "--provider",
      db.provider,
      ...extra,
    ],
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
    await runPreload(ctx, [
      "--mode",
      "console",
      ...(args.sandbox ? ["--sandbox"] : []),
    ])
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
    await runPreload(ctx, [
      "--mode",
      "runner",
      ...(existsSync(file) ? ["--file", file] : ["--expr", args.target]),
      ...(args.sandbox ? ["--sandbox"] : []),
    ])
    return undefined
  },
})

export { consoleCommand, runner }
