/**
 * Environment resolution for the target app. `.env.local` wins over
 * `.env`; variables already in the process win over both. `APP_ENV`
 * selects the environment and defaults to `local`.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { WeeError } from "../core/errors.js"

type AppEnv = "local" | "preview" | "production" | (string & {})

const ENV_FILES = [".env.local", ".env"]

const appEnv = (): AppEnv => process.env.APP_ENV ?? "local"

/** Loads the target's env files once. Existing variables are not overridden. */
const loadTargetEnv = (targetPath: string): void => {
  for (const name of ENV_FILES) {
    const file = join(targetPath, name)
    if (existsSync(file)) {
      process.loadEnvFile(file)
    }
  }
}

const databaseUrl = (targetPath: string): string => {
  loadTargetEnv(targetPath)
  const url = process.env.DATABASE_URL
  if (url === undefined || url.length === 0) {
    throw new WeeError(
      "database-url-missing",
      "DATABASE_URL is not set. Add it to .env.local or the environment."
    )
  }
  return url
}

export type { AppEnv }
export { appEnv, databaseUrl, loadTargetEnv }
