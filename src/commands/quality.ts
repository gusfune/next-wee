/**
 * `wee lint`, `wee typecheck`, `wee test [path] [--watch]` and
 * `wee test:e2e [--headed]`. Thin wrappers over the target's Biome or
 * ESLint, `next typegen` + `tsc`, Vitest and Playwright. Output streams to
 * the terminal; the exit code is the tool's.
 */
import type { CommandResult } from "../core/command.js"
import { defineWeeCommand } from "../core/command.js"
import type { Context } from "../core/context.js"
import { assertAppRouter } from "../core/context.js"
import { WeeError } from "../core/errors.js"
import type { TaskResult } from "../lib/tasks.js"
import {
  lint,
  PLAYWRIGHT_CONFIG,
  test,
  testE2e,
  typecheck,
} from "../lib/tasks.js"
import { rowsOf } from "./g/setup.js"

/**
 * Turns a tool result into the command's result. Human mode streamed the
 * output already, so a row is only useful for `--json`. A failure becomes a
 * `WeeError` with the tool's exit code and, in `--json` mode, its output.
 */
const finish = (
  ctx: Context,
  name: string,
  result: TaskResult
): CommandResult | undefined => {
  if (result.exitCode !== 0) {
    throw new WeeError(`${name}-failed`, `${name} failed`, {
      exitCode: result.exitCode,
      ...(ctx.flags.json ? { data: { output: result.output } } : {}),
    })
  }
  return ctx.flags.json ? { data: { action: name, path: "ok" } } : undefined
}

/** Tools stream to the terminal; `--json` captures so stdout stays one JSON document. */
const stdioFor = (ctx: Context): "inherit" | "pipe" =>
  ctx.flags.json ? "pipe" : "inherit"

const lintCommand = defineWeeCommand({
  meta: { name: "lint", description: "Biome or ESLint, whichever the app has" },
  run: async (ctx) =>
    finish(ctx, "lint", await lint({ ctx, stdio: stdioFor(ctx) })),
})

const typecheckCommand = defineWeeCommand({
  meta: { name: "typecheck", description: "next typegen, then tsc --noEmit" },
  run: async (ctx) =>
    finish(ctx, "typecheck", await typecheck({ ctx, stdio: stdioFor(ctx) })),
})

const testCommand = defineWeeCommand({
  meta: { name: "test", description: "Vitest (all tests, or one path)" },
  args: {
    path: {
      type: "positional",
      description: "Test file or folder",
      required: false,
    },
    watch: { type: "boolean", description: "Watch mode", default: false },
  },
  run: async (ctx, args) =>
    finish(
      ctx,
      "test",
      await test({
        ctx,
        stdio: stdioFor(ctx),
        path: args.path,
        watch: args.watch,
      })
    ),
})

const testE2eCommand = defineWeeCommand({
  meta: {
    name: "test:e2e",
    description: "Playwright against a fresh db:prepare",
  },
  args: {
    headed: {
      type: "boolean",
      description: "Show the browser",
      default: false,
    },
  },
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const result = await testE2e({
      ctx,
      stdio: stdioFor(ctx),
      headed: args.headed,
    })
    if (result.wroteConfig && !ctx.flags.json) {
      process.stdout.write(`wrote ${PLAYWRIGHT_CONFIG}\n`)
    }
    const finished = finish(ctx, "test:e2e", result)
    if (finished === undefined || !result.wroteConfig) {
      return finished
    }
    return {
      data: [
        { action: "create", path: PLAYWRIGHT_CONFIG },
        ...rowsOf(finished.data),
      ],
    }
  },
})

export {
  finish,
  lintCommand as lint,
  stdioFor,
  testCommand as test,
  testE2eCommand as testE2e,
  typecheckCommand as typecheck,
}
