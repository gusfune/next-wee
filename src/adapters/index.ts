/**
 * Resolves the configured `DbAdapter` for a target app. Every `db:*`
 * command and the model generators go through here, so an app that has
 * not run `db:init` (or lost its scaffold) fails before anything runs.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { DbAdapter } from "../core/adapters.js"
import type { Context } from "../core/context.js"
import { sourceDir } from "../core/context.js"
import { WeeError } from "../core/errors.js"
import { hasDependency, readPackageJson } from "../core/repo.js"
import { drizzleAdapter } from "./drizzle/index.js"
import { prismaAdapter } from "./prisma/index.js"

type AdapterName = DbAdapter["name"]

const dbAdapters: Record<AdapterName, DbAdapter> = {
  drizzle: drizzleAdapter,
  prisma: prismaAdapter,
}

/** Files and the runtime package an initialised app must have. */
const SCAFFOLD: Record<AdapterName, { config: string; dependency: string }> = {
  drizzle: { config: "drizzle.config.ts", dependency: "drizzle-orm" },
  prisma: { config: "prisma.config.ts", dependency: "@prisma/client" },
}

const initHint = (adapter: AdapterName): string =>
  `Run "wee db:init --adapter=${adapter}" first.`

/** Throws unless config, config file, schema dir and the ORM package are all present. */
const assertDbReady = (ctx: Context): void => {
  const db = ctx.config.db
  if (db === undefined) {
    throw new WeeError(
      "db-not-initialised",
      `No db section in ${ctx.configPath}. ${initHint("drizzle")}`
    )
  }
  const scaffold = SCAFFOLD[db.adapter]
  const target = ctx.target.path
  const schemaDir = join(sourceDir(ctx), db.schemaDir)
  const missing = [
    ...(existsSync(join(target, scaffold.config)) ? [] : [scaffold.config]),
    ...(existsSync(join(target, schemaDir)) ? [] : [`${schemaDir}/`]),
    ...(hasDependency(readPackageJson(target), scaffold.dependency)
      ? []
      : [`${scaffold.dependency} in package.json`]),
  ]
  if (missing.length > 0) {
    throw new WeeError(
      "db-not-ready",
      `${ctx.configPath} has a db section but the app is missing: ${missing.join(", ")}. ${initHint(db.adapter)}`,
      { data: { missing } }
    )
  }
}

const getDbAdapter = (ctx: Context): DbAdapter => {
  assertDbReady(ctx)
  return dbAdapters[ctx.config.db?.adapter ?? "drizzle"]
}

export type { AdapterName }
export { assertDbReady, dbAdapters, getDbAdapter }
