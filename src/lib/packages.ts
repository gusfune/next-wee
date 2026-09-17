/**
 * Access to packages installed in the target app. The CLI does not bundle
 * drizzle-kit or database drivers; it resolves them from the target's
 * `node_modules` (walking up for hoisted monorepos) and runs or imports
 * them from there.
 */
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { addDependency, addDevDependency } from "nypm"
import { x } from "tinyexec"
import type { Context } from "../core/context.js"
import { WeeError } from "../core/errors.js"

const packageDir = (targetPath: string, name: string): string => {
  let dir = targetPath
  while (true) {
    const candidate = join(dir, "node_modules", name)
    if (existsSync(join(candidate, "package.json"))) {
      return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) {
      throw new WeeError(
        "package-missing",
        `${name} is not installed in ${targetPath}. Run "wee db:init" or install it.`
      )
    }
    dir = parent
  }
}

const packageBin = (targetPath: string, name: string): string => {
  const dir = packageDir(targetPath, name)
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
    bin?: string | Record<string, string>
  }
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[name]
  if (bin === undefined) {
    throw new WeeError("package-missing", `${name} has no "${name}" binary`)
  }
  return join(dir, bin)
}

interface RunBinOptions {
  targetPath: string
  name: string
  args: string[]
  /** `inherit` streams to the terminal. `pipe` captures and returns stdout. */
  stdio: "inherit" | "pipe"
}

/** Runs a package binary with the target as cwd. Throws on a non-zero exit. */
interface RunBinResult {
  stdout: string
  stderr: string
}

const runBin = async (options: RunBinOptions): Promise<RunBinResult> => {
  const { targetPath, name, args, stdio } = options
  const bin = packageBin(targetPath, name)
  const result = await x("node", [bin, ...args], {
    nodeOptions: { cwd: targetPath, stdio },
    throwOnError: false,
  })
  if (result.exitCode !== 0) {
    // With stdio "inherit" the output already went to the terminal.
    const captured = result.stdout.length > 0 || result.stderr.length > 0
    throw new WeeError(`${name}-failed`, `${name} ${args[0] ?? ""} failed`, {
      exitCode: result.exitCode ?? 1,
      ...(captured
        ? { data: { stdout: result.stdout, stderr: result.stderr } }
        : {}),
    })
  }
  return { stdout: result.stdout, stderr: result.stderr }
}

/** Imports a module from the target's dependency tree (ESM or CJS). */
const importFromTarget = async <T>(
  targetPath: string,
  name: string
): Promise<T> => {
  const require = createRequire(
    join(packageDir(targetPath, name.split("/")[0] ?? name), "package.json")
  )
  const resolved = require.resolve(name)
  return (await import(pathToFileURL(resolved).href)) as T
}

interface InstallOptions {
  ctx: Context
  dependencies: string[]
  devDependencies: string[]
}

const installPackages = async (options: InstallOptions): Promise<void> => {
  const { ctx, dependencies, devDependencies } = options
  const shared = {
    cwd: ctx.target.path,
    packageManager: ctx.repo.packageManager,
    silent: ctx.flags.json,
    ...(ctx.repo.shape === "single" ? {} : { workspace: ctx.target.name }),
  }
  if (dependencies.length > 0) {
    await addDependency(dependencies, shared)
  }
  if (devDependencies.length > 0) {
    await addDevDependency(devDependencies, shared)
  }
}

export type { RunBinResult }
export { importFromTarget, installPackages, packageBin, packageDir, runBin }
