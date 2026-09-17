/**
 * `wee db:*` commands. Each one resolves the adapter from `.app/config.json`
 * and delegates. `db:init` is the only generator here; it writes files
 * through a manifest and then installs packages.
 */

import { drizzleAdapter } from "../adapters/drizzle/index.js"
import { getDbAdapter } from "../adapters/index.js"
import type { DbProvider } from "../core/adapters.js"
import type { CommandResult } from "../core/command.js"
import { defineWeeCommand } from "../core/command.js"
import type { Context } from "../core/context.js"
import { assertAppRouter } from "../core/context.js"
import { WeeError } from "../core/errors.js"
import { defineGenerator, runGenerator } from "../core/generator.js"
import type { Row } from "../core/output.js"
import { appEnv } from "../lib/env.js"
import { installPackages } from "../lib/packages.js"

const PROVIDERS: DbProvider[] = ["postgres", "sqlite", "mysql"]

const parseProvider = (raw: string): DbProvider => {
  const found = PROVIDERS.find((provider) => provider === raw)
  if (found === undefined) {
    throw new WeeError(
      "invalid-provider",
      `--provider must be one of ${PROVIDERS.join(", ")}`
    )
  }
  return found
}

const dbInitGenerator = defineGenerator({
  name: "db",
  description: "Set up the database adapter, client, schema and seed runner",
  args: {
    adapter: {
      type: "string",
      description: "drizzle (prisma arrives in phase 4)",
      default: "drizzle",
    },
    provider: {
      type: "string",
      description: "postgres | sqlite | mysql",
      default: "postgres",
    },
    "skip-install": {
      type: "boolean",
      description: "Write files, do not install packages",
      default: false,
    },
  },
  manifestName: () => "init",
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    if (args.adapter !== "drizzle") {
      throw new WeeError(
        "adapter-unavailable",
        `Adapter "${args.adapter}" is not available. Use drizzle.`
      )
    }
    if (ctx.config.db !== undefined && !ctx.flags.force) {
      throw new WeeError(
        "db-already-initialised",
        `${ctx.configPath} already has a db section. Pass --force to overwrite.`
      )
    }
    const result = await drizzleAdapter.init(ctx, {
      provider: parseProvider(args.provider),
    })
    return result.changes
  },
})

const dbInit = defineWeeCommand({
  meta: { name: "db:init", description: dbInitGenerator.description },
  args: dbInitGenerator.args,
  run: async (ctx, args) => {
    const result = await runGenerator({ ctx, generator: dbInitGenerator, args })
    if (ctx.flags.dryRun || args["skip-install"]) {
      return result
    }
    // The generator already validated the provider; recompute the package
    // lists from the adapter so they stay in one place.
    const { dependencies, devDependencies } = await drizzleAdapter.init(ctx, {
      provider: parseProvider(args.provider),
    })
    await installPackages({ ctx, dependencies, devDependencies })
    const rows = Array.isArray(result.data) ? result.data : [result.data]
    return {
      ...result,
      data: [
        ...rows,
        { action: "install", path: dependencies.join(" ") },
        { action: "install:dev", path: devDependencies.join(" ") },
      ],
    }
  },
})

/** drizzle-kit already printed in human mode; a row is only useful for `--json`. */
const report = (
  ctx: Context,
  action: string,
  path = ""
): CommandResult | undefined =>
  ctx.flags.json ? { data: { action, path } } : undefined

const okRow = (action: string, path = ""): Row => ({ action, path })

const dbGenerate = defineWeeCommand({
  meta: {
    name: "db:generate",
    description: "Diff the schema and write a migration (drizzle-kit generate)",
  },
  args: { name: { type: "string", description: "Migration name" } },
  run: async (ctx, args) => {
    await getDbAdapter(ctx).generate(ctx, args.name)
    return report(ctx, "generate")
  },
})

const dbMigrate = defineWeeCommand({
  meta: { name: "db:migrate", description: "Apply pending migrations" },
  run: async (ctx) => {
    await getDbAdapter(ctx).migrate(ctx)
    return report(ctx, "migrate")
  },
})

const dbRollback = defineWeeCommand({
  meta: {
    name: "db:rollback",
    description: "Revert the last migration (or --step=n)",
  },
  args: {
    step: {
      type: "string",
      description: "How many migrations to revert",
      default: "1",
    },
  },
  run: async (ctx, args) => {
    const step = Number.parseInt(args.step, 10)
    if (!Number.isInteger(step) || step < 1) {
      throw new WeeError("invalid-step", "--step must be a positive integer")
    }
    const rolledBack = await getDbAdapter(ctx).rollback(ctx, step)
    if (rolledBack.length === 0) {
      return { title: "nothing to roll back", data: [] }
    }
    return {
      title: "rolled back",
      data: rolledBack.map((tag) => okRow("rollback", tag)),
    }
  },
})

const dbStatus = defineWeeCommand({
  meta: {
    name: "db:status",
    description: "List migrations and whether they are applied",
  },
  run: async (ctx) => {
    const status = await getDbAdapter(ctx).status(ctx)
    return {
      title: "migrations",
      data: status.map((entry) => ({
        action: entry.applied ? "applied" : "pending",
        path: entry.name,
        when: entry.when,
      })),
    }
  },
})

const dbPush = defineWeeCommand({
  meta: {
    name: "db:push",
    description: "Push the schema without a migration (local and preview only)",
  },
  run: async (ctx) => {
    await getDbAdapter(ctx).push(ctx)
    return report(ctx, "push", appEnv())
  },
})

const seedArgs = {
  file: { type: "string", description: "Run one seed file only" },
} as const

const runSeed = async (
  ctx: Context,
  file: string | undefined,
  replant: boolean
): Promise<CommandResult> => {
  await getDbAdapter(ctx).seed(ctx, {
    ...(file === undefined ? {} : { file }),
    replant,
  })
  return { data: okRow(replant ? "seed:replant" : "seed", file ?? "all") }
}

const dbSeed = defineWeeCommand({
  meta: {
    name: "db:seed",
    description: "Run src/db/seed.ts (all seeds or --file)",
  },
  args: seedArgs,
  run: (ctx, args) => runSeed(ctx, args.file, false),
})

const dbSeedReplant = defineWeeCommand({
  meta: {
    name: "db:seed:replant",
    description: "Truncate seeded tables, then seed",
  },
  args: seedArgs,
  run: (ctx, args) => runSeed(ctx, args.file, true),
})

const dbPrepare = defineWeeCommand({
  meta: {
    name: "db:prepare",
    description: "Create the database if missing, migrate, seed when fresh",
  },
  run: async (ctx) => {
    const result = await getDbAdapter(ctx).prepare(ctx)
    return {
      title: "prepare",
      data: [
        okRow(result.created ? "created" : "exists", "database"),
        okRow(result.migrated ? "migrated" : "no-migrations"),
        okRow(result.seeded ? "seeded" : "not-seeded"),
      ],
    }
  },
})

const dbReset = defineWeeCommand({
  meta: {
    name: "db:reset",
    description: "Drop the database, then prepare (refuses in production)",
  },
  run: async (ctx) => {
    await getDbAdapter(ctx).reset(ctx)
    return { data: okRow("reset", appEnv()) }
  },
})

const dbStudio = defineWeeCommand({
  meta: { name: "db:studio", description: "Open Drizzle Studio" },
  run: async (ctx) => {
    await getDbAdapter(ctx).studio(ctx)
    return undefined
  },
})

const dbConsole = defineWeeCommand({
  meta: {
    name: "db:console",
    description: "Open a SQL shell (psql, sqlite3 or mysql)",
  },
  run: async (ctx) => {
    await getDbAdapter(ctx).console(ctx)
    return undefined
  },
})

export {
  dbConsole,
  dbGenerate,
  dbInit,
  dbInitGenerator,
  dbMigrate,
  dbPrepare,
  dbPush,
  dbReset,
  dbRollback,
  dbSeed,
  dbSeedReplant,
  dbStatus,
  dbStudio,
}
