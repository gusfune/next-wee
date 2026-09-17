/**
 * Context built once per run: repo shape, target workspace, config and
 * global flags. Every command receives it. Commands that need the App
 * Router call `assertAppRouter`.
 */

import pkg from "../../package.json" with { type: "json" }
import type { AppConfig, AppLayout } from "./config.js"
import { loadConfig } from "./config.js"
import { WeeError } from "./errors.js"
import type { RepoInfo } from "./repo.js"
import { detectRepo } from "./repo.js"
import type { Target } from "./workspace.js"
import { selectTarget } from "./workspace.js"

interface GlobalFlags {
  dryRun: boolean
  json: boolean
  force: boolean
  app?: string | undefined
  pkg?: string | undefined
}

interface Context {
  cwd: string
  cliVersion: string
  flags: GlobalFlags
  repo: RepoInfo
  target: Target
  config: AppConfig
  layout: AppLayout
  configPath: string
  hasConfigFile: boolean
}

interface BuildContextOptions {
  cwd: string
  flags: GlobalFlags
}

const buildContext = async (options: BuildContextOptions): Promise<Context> => {
  const { cwd, flags } = options
  const repo = await detectRepo(cwd)
  const target = await selectTarget({
    repo,
    app: flags.app,
    pkg: flags.pkg,
    json: flags.json,
    interactive: process.stdin.isTTY === true,
  })
  const loaded = loadConfig({ repoRoot: repo.root, targetPath: target.path })
  return {
    cwd,
    cliVersion: pkg.version,
    flags,
    repo,
    target,
    ...loaded,
  }
}

const assertAppRouter = (ctx: Context): void => {
  if (ctx.target.kind !== "app") {
    return
  }
  if (
    ctx.config.router !== "app" ||
    (ctx.layout.appDir === undefined && ctx.layout.hasPagesDir)
  ) {
    throw new WeeError(
      "app-router-only",
      `${ctx.target.name} uses the Pages Router. This CLI supports the App Router only.`
    )
  }
}

/** Source root of the target: `src/` when `srcDir` is on, else the app root. */
const sourceDir = (ctx: Context): string => (ctx.config.srcDir ? "src" : ".")

export type { Context, GlobalFlags }
export { assertAppRouter, buildContext, sourceDir }
