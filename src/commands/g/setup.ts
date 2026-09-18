/**
 * Helpers for generators that wire an integration (auth, jobs, mail):
 * `.env.example` keys written once, config patches and the install rows
 * that follow a run.
 */
import { join } from "node:path"
import type { FileChange } from "../../core/changes.js"
import { readIfExists } from "../../core/changes.js"
import type { CommandResult } from "../../core/command.js"
import type { AppConfigInput } from "../../core/config.js"
import { configChange } from "../../core/config.js"
import type { Context } from "../../core/context.js"
import { hasBlock } from "../../core/inject.js"
import { installPackages, missingPackages } from "../../lib/packages.js"

const ENV_EXAMPLE = ".env.example"

/** Injects `NAME=` lines under one marker, unless the block is there already. */
const envExampleChanges = (
  ctx: Context,
  marker: string,
  names: string[]
): FileChange[] => {
  const source = readIfExists(join(ctx.target.path, ENV_EXAMPLE))
  if (source !== undefined && hasBlock(source, ENV_EXAMPLE, marker)) {
    return []
  }
  return [
    {
      kind: "inject",
      path: ENV_EXAMPLE,
      marker,
      content: names.map((name) => `${name}=`).join("\n"),
    },
  ]
}

/** Merges `patch` into `.app/config.json`. */
const configPatch = (
  ctx: Context,
  patch: Partial<AppConfigInput>
): FileChange =>
  configChange({ targetPath: ctx.target.path, current: ctx.config, patch })

interface InstallRowsOptions {
  ctx: Context
  dependencies: string[]
  devDependencies: string[]
  skipInstall: boolean
}

/**
 * Installs the packages the app lacks, or notes them under `--dry-run` and
 * `--skip-install`. Returns the rows to append to the generator's output.
 */
const installRows = async (
  options: InstallRowsOptions
): Promise<CommandResult["data"]> => {
  const { ctx, skipInstall } = options
  const dependencies = missingPackages(ctx.target.path, options.dependencies)
  const devDependencies = missingPackages(
    ctx.target.path,
    options.devDependencies
  )
  const names = [...dependencies, ...devDependencies]
  if (names.length === 0) {
    return []
  }
  if (ctx.flags.dryRun || skipInstall) {
    return [
      {
        action: "note",
        path: `add ${names.join(", ")} to package.json`,
      },
    ]
  }
  await installPackages({ ctx, dependencies, devDependencies })
  return names.map((name) => ({ action: "install", path: name }))
}

/** Rows of a generator result as a flat list. */
const rowsOf = (data: CommandResult["data"]): Record<string, unknown>[] =>
  Array.isArray(data) ? data : [data]

const skipInstallArg = {
  "skip-install": {
    type: "boolean",
    description: "Do not install packages",
    default: false,
  },
} as const

export { configPatch, envExampleChanges, installRows, rowsOf, skipInstallArg }
