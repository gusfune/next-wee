/**
 * Detects a Drizzle setup that exists before `wee db:init` runs, so init
 * can adopt it instead of writing a second one. The config file is read
 * with regular expressions, not executed: it may import env loaders or
 * other code we do not want to run.
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join, normalize, relative } from "node:path"
import type { DbProvider } from "../../core/adapters.js"
import { WeeError } from "../../core/errors.js"

const CONFIG_FILES = [
  "drizzle.config.ts",
  "drizzle.config.mts",
  "drizzle.config.js",
  "drizzle.config.mjs",
]

const DIALECT_PROVIDER: Record<string, DbProvider> = {
  postgresql: "postgres",
  postgres: "postgres",
  pg: "postgres",
  sqlite: "sqlite",
  mysql: "mysql",
}

interface AdoptedConfig {
  /** Config file name, relative to the target. */
  file: string
  provider: DbProvider
  /** Relative to the target app, e.g. `src/db/schema`. */
  schemaDir: string
  /** Relative to the target app, e.g. `src/db/migrations`. */
  migrationsDir: string
}

const stringOption = (source: string, key: string): string | undefined =>
  source.match(new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`))?.[1]

/** Strips a trailing glob (`/*`, `/**\/*.ts`) so a schema glob maps to its directory. */
const globDir = (value: string): string => {
  const index = value.indexOf("*")
  return index === -1 ? value : dirname(value.slice(0, index + 1))
}

/** Returns the existing config, or undefined when the app has none. */
const detectDrizzleConfig = (targetPath: string): AdoptedConfig | undefined => {
  const file = CONFIG_FILES.find((name) => existsSync(join(targetPath, name)))
  if (file === undefined) {
    return undefined
  }
  const source = readFileSync(join(targetPath, file), "utf8")
  const dialect = stringOption(source, "dialect")
  const provider = dialect === undefined ? undefined : DIALECT_PROVIDER[dialect]
  if (provider === undefined) {
    throw new WeeError(
      "drizzle-config-unsupported",
      `${file}: dialect "${dialect ?? "(missing)"}" is not supported. Use postgresql, sqlite or mysql.`
    )
  }
  const schema = stringOption(source, "schema")
  if (schema === undefined) {
    throw new WeeError(
      "drizzle-config-unsupported",
      `${file}: no string "schema" option. wee needs a schema directory with an index.ts barrel.`
    )
  }
  const schemaDir = normalize(globDir(schema))
  const schemaPath = join(targetPath, schemaDir)
  if (!existsSync(schemaPath) || !statSync(schemaPath).isDirectory()) {
    const asDir = schemaDir.replace(/\.[cm]?[jt]s$/, "")
    throw new WeeError(
      "drizzle-config-unsupported",
      `${file}: schema "${schema}" must point to a directory. wee generates one file per model there. Move the file to ${asDir}/index.ts, fix its relative imports, set schema to "./${asDir}" and retry.`
    )
  }
  const migrationsDir = normalize(stringOption(source, "out") ?? "drizzle")
  return {
    file,
    provider,
    schemaDir: relative(".", schemaDir) || ".",
    migrationsDir: relative(".", migrationsDir) || ".",
  }
}

export type { AdoptedConfig }
export { detectDrizzleConfig }
