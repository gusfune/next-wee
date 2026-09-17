/** Resolves the configured `DbAdapter` for a target app. */
import type { DbAdapter } from "../core/adapters.js"
import type { Context } from "../core/context.js"
import { WeeError } from "../core/errors.js"
import { drizzleAdapter } from "./drizzle/index.js"

const getDbAdapter = (ctx: Context): DbAdapter => {
  const db = ctx.config.db
  if (db === undefined) {
    throw new WeeError(
      "db-not-initialised",
      'No database adapter. Run "wee db:init --adapter=drizzle" first.'
    )
  }
  if (db.adapter === "prisma") {
    throw new WeeError(
      "adapter-unavailable",
      "The Prisma adapter arrives in phase 4. Use drizzle."
    )
  }
  return drizzleAdapter
}

export { getDbAdapter }
