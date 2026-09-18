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

/** Directory of an installed package, walking up for hoisted monorepos. Undefined when absent. */
const findPackageDir = (
  targetPath: string,
  name: string
): string | undefined => {
  let dir = targetPath
  while (true) {
    const candidate = join(dir, "node_modules", name)
    if (existsSync(join(candidate, "package.json"))) {
      return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) {
      return undefined
    }
    dir = parent
  }
}

const packageDir = (targetPath: string, name: string): string => {
  const dir = findPackageDir(targetPath, name)
  if (dir === undefined) {
    throw new WeeError(
      "package-missing",
      `${name} is not installed in ${targetPath}. Run "wee db:init" or install it.`
    )
  }
  return dir
}

const hasPackage = (targetPath: string, name: string): boolean =>
  findPackageDir(targetPath, name) !== undefined

/** Path of a package's binary. `bin` names it when it differs from the package, e.g. `email` in `react-email`. */
const packageBin = (targetPath: string, name: string, bin = name): string => {
  const dir = packageDir(targetPath, name)
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
    bin?: string | Record<string, string>
  }
  const file = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[bin]
  if (file === undefined) {
    throw new WeeError("package-missing", `${name} has no "${bin}" binary`)
  }
  return join(dir, file)
}

/** Names from the list that the target's package.json does not have yet. */
const missingPackages = (targetPath: string, names: string[]): string[] => {
  const pkg = JSON.parse(
    readFileSync(join(targetPath, "package.json"), "utf8")
  ) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  return names.filter(
    (name) =>
      pkg.dependencies?.[name] === undefined &&
      pkg.devDependencies?.[name] === undefined
  )
}

interface RunBinOptions {
  targetPath: string
  name: string
  /** Binary name when it differs from the package name. */
  bin?: string
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
  const bin = packageBin(targetPath, name, options.bin)
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

interface RunScriptOptions {
  ctx: Context
  /** Script path. TypeScript is fine: tsx (or bun) compiles it. */
  script: string
  args: string[]
  stdio: "inherit" | "pipe"
  /** Package export conditions, e.g. `react-server` so `server-only` loads. */
  conditions?: string[]
}

interface RunScriptResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Runs a TypeScript script inside the target app. Bun repos run it with
 * `bun`; every other repo runs `node --import tsx`, which `db:init`
 * installs. The target's env files are loaded first so the script sees
 * `DATABASE_URL`.
 */
const runScript = async (
  options: RunScriptOptions
): Promise<RunScriptResult> => {
  const { ctx, script, args, stdio, conditions = [] } = options
  const useBun = ctx.repo.packageManager === "bun"
  const conditionArgs = conditions.map((name) => `--conditions=${name}`)
  if (!useBun) {
    packageDir(ctx.target.path, "tsx")
  }
  const result = await x(
    useBun ? "bun" : "node",
    useBun
      ? [...conditionArgs, script, ...args]
      : [...conditionArgs, "--import", "tsx", script, ...args],
    {
      nodeOptions: { cwd: ctx.target.path, stdio },
      throwOnError: false,
    }
  )
  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

interface RunToolOptions {
  targetPath: string
  name: string
  /** Binary name when it differs from the package name. */
  bin?: string
  args: string[]
  /** Working directory; the target by default. */
  cwd?: string
  stdio: "inherit" | "pipe"
}

interface RunToolResult {
  exitCode: number
  /** stdout and stderr together; empty with `inherit`. */
  output: string
}

/**
 * Runs a package binary and returns the exit code instead of throwing. For
 * tools whose failure is a result, not an error: linters, type checkers,
 * test runners and builds.
 */
const runTool = async (options: RunToolOptions): Promise<RunToolResult> => {
  const { targetPath, name, args, stdio } = options
  const bin = packageBin(targetPath, name, options.bin)
  const result = await x("node", [bin, ...args], {
    nodeOptions: { cwd: options.cwd ?? targetPath, stdio },
    throwOnError: false,
  })
  return {
    exitCode: result.exitCode ?? 1,
    output: `${result.stdout}${result.stderr}`,
  }
}

/** Installed Bun version, or undefined when `bun` is not on PATH. */
const bunVersion = async (): Promise<string | undefined> => {
  const result = await x("bun", ["--version"], { throwOnError: false })
  return result.exitCode === 0 ? result.stdout.trim() : undefined
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

export type { RunBinResult, RunScriptResult, RunToolResult }
export {
  bunVersion,
  findPackageDir,
  hasPackage,
  importFromTarget,
  installPackages,
  missingPackages,
  packageBin,
  packageDir,
  runBin,
  runScript,
  runTool,
}
