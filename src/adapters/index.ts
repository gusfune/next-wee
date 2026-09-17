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

const INIT_HINT = 'Run "wee db:init --adapter=drizzle" first.'

/** Throws unless config, config file, schema dir and drizzle-orm are all present. */
const assertDbReady = (ctx: Context): void => {
  const db = ctx.config.db
  if (db === undefined) {
    throw new WeeError(
      "db-not-initialised",
      `No db section in ${ctx.configPath}. ${INIT_HINT}`
    )
  }
  if (db.adapter === "prisma") {
    throw new WeeError(
      "adapter-unavailable",
      "The Prisma adapter arrives in phase 4. Use drizzle."
    )
  }
  const target = ctx.target.path
  const schemaDir = join(sourceDir(ctx), db.schemaDir)
  const missing = [
    ...(existsSync(join(target, "drizzle.config.ts"))
      ? []
      : ["drizzle.config.ts"]),
    ...(existsSync(join(target, schemaDir)) ? [] : [`${schemaDir}/`]),
    ...(hasDependency(readPackageJson(target), "drizzle-orm")
      ? []
      : ["drizzle-orm in package.json"]),
  ]
  if (missing.length > 0) {
    throw new WeeError(
      "db-not-ready",
      `${ctx.configPath} has a db section but the app is missing: ${missing.join(", ")}. ${INIT_HINT}`,
      { data: { missing } }
    )
  }
}

const getDbAdapter = (ctx: Context): DbAdapter => {
  assertDbReady(ctx)
  return drizzleAdapter
}

export { assertDbReady, getDbAdapter }
