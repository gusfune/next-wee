/**
 * App configuration. `<app>/.app/config.json` wins over the root
 * `app.config.json`. Missing files fall back to defaults derived from the
 * target's file layout.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { WeeError } from "./errors.js"

const dbConfigSchema = z.object({
  adapter: z.enum(["drizzle", "prisma"]),
  provider: z.enum(["postgres", "sqlite", "mysql"]).default("postgres"),
  schemaDir: z.string().default("db/schema"),
  migrationsDir: z.string().default("db/migrations"),
})

const appConfigSchema = z.object({
  router: z.enum(["app", "pages"]).optional(),
  srcDir: z.boolean().optional(),
  db: dbConfigSchema.optional(),
  auth: z.object({ provider: z.string() }).optional(),
  jobs: z.object({ provider: z.string() }).optional(),
})

type AppConfigInput = z.input<typeof appConfigSchema>
type AppConfig = z.output<typeof appConfigSchema>

const CONFIG_DIR = ".app"
const CONFIG_FILE = "config.json"
const ROOT_CONFIG_FILE = "app.config.json"

const readConfigFile = (file: string): AppConfigInput => {
  if (!existsSync(file)) {
    return {}
  }
  const result = appConfigSchema.safeParse(
    JSON.parse(readFileSync(file, "utf8"))
  )
  if (!result.success) {
    throw new WeeError(
      "invalid-config",
      `Invalid config ${file}: ${z.prettifyError(result.error)}`
    )
  }
  return result.data
}

/** Detects `srcDir`, the router and the pages dir from the target's file tree. */
interface AppLayout {
  srcDir: boolean
  appDir: string | undefined
  hasPagesDir: boolean
}

const detectLayout = (targetPath: string): AppLayout => {
  const candidates = [
    { srcDir: true, appDir: join(targetPath, "src", "app") },
    { srcDir: false, appDir: join(targetPath, "app") },
  ]
  const found = candidates.find((candidate) => existsSync(candidate.appDir))
  const hasPagesDir =
    existsSync(join(targetPath, "src", "pages")) ||
    existsSync(join(targetPath, "pages"))
  return {
    srcDir: found?.srcDir ?? existsSync(join(targetPath, "src")),
    appDir: found?.appDir,
    hasPagesDir,
  }
}

interface LoadConfigOptions {
  repoRoot: string
  targetPath: string
}

interface LoadedConfig {
  config: AppConfig
  layout: AppLayout
  configPath: string
  hasConfigFile: boolean
}

const loadConfig = (options: LoadConfigOptions): LoadedConfig => {
  const { repoRoot, targetPath } = options
  const rootConfig = readConfigFile(join(repoRoot, ROOT_CONFIG_FILE))
  const configPath = join(targetPath, CONFIG_DIR, CONFIG_FILE)
  const hasConfigFile = existsSync(configPath)
  const appConfig = readConfigFile(configPath)
  const layout = detectLayout(targetPath)
  const merged = appConfigSchema.parse({ ...rootConfig, ...appConfig })
  const config: AppConfig = {
    ...merged,
    router:
      merged.router ??
      (layout.appDir === undefined && layout.hasPagesDir ? "pages" : "app"),
    srcDir: merged.srcDir ?? layout.srcDir,
  }
  return { config, layout, configPath, hasConfigFile }
}

export type { AppConfig, AppConfigInput, AppLayout, LoadedConfig }
export {
  appConfigSchema,
  CONFIG_DIR,
  CONFIG_FILE,
  loadConfig,
  ROOT_CONFIG_FILE,
}
