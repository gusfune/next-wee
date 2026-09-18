/**
 * `wee dev [--port]`, `wee build` and `wee start [--port]`. `dev` prepares
 * the database and starts the jobs dev server before `next dev`; `build`
 * typechecks first. Turborepo tasks delegate to `turbo run`.
 */
import { defineWeeCommand } from "../core/command.js"
import { assertAppRouter } from "../core/context.js"
import { build, dev, start } from "../lib/tasks.js"
import { finish, stdioFor } from "./quality.js"

const portArg = {
  port: { type: "string", description: "Port for the server" },
} as const

const devCommand = defineWeeCommand({
  meta: {
    name: "dev",
    description: "db:prepare, jobs dev server, then next dev",
  },
  args: portArg,
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    return finish(
      ctx,
      "dev",
      await dev({ ctx, stdio: stdioFor(ctx), port: args.port })
    )
  },
})

const buildCommand = defineWeeCommand({
  meta: { name: "build", description: "typecheck, then next build" },
  run: async (ctx) => {
    assertAppRouter(ctx)
    return finish(ctx, "build", await build({ ctx, stdio: stdioFor(ctx) }))
  },
})

const startCommand = defineWeeCommand({
  meta: { name: "start", description: "next start" },
  args: portArg,
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    return finish(
      ctx,
      "start",
      await start({ ctx, stdio: stdioFor(ctx), port: args.port })
    )
  },
})

export { buildCommand as build, devCommand as dev, startCommand as start }
