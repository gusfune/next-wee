/**
 * Repository detection. Runs before every command.
 *
 * The root is the nearest ancestor of `cwd` that holds a `turbo.json`,
 * a `pnpm-workspace.yaml` or a `package.json` with `workspaces`. The walk
 * stops at the first `.git` directory. When no monorepo marker exists, the
 * nearest `package.json` is the root and the repo shape is `single`.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import type { PackageManagerName } from "nypm"
import { detectPackageManager } from "nypm"
import { glob } from "tinyglobby"
import { parse as parseYaml } from "yaml"
import { WeeError } from "./errors.js"

type RepoShape = "single" | "turborepo" | "workspaces"

interface PackageJson {
  name?: string
  workspaces?: string[] | { packages?: string[] }
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

interface Workspace {
  name: string
  path: string
  isNextApp: boolean
}

interface RepoInfo {
  root: string
  shape: RepoShape
  hasTurbo: boolean
  turboTasks: string[]
  packageManager: PackageManagerName
  workspaces: Workspace[]
}

const readPackageJson = (dir: string): PackageJson | undefined => {
  const file = join(dir, "package.json")
  if (!existsSync(file)) {
    return undefined
  }
  try {
    return JSON.parse(readFileSync(file, "utf8")) as PackageJson
  } catch (error) {
    throw new WeeError(
      "invalid-package-json",
      `Cannot parse ${file}: ${String(error)}`
    )
  }
}

const hasDependency = (pkg: PackageJson | undefined, name: string): boolean => {
  return Boolean(pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name])
}

const workspaceGlobs = (pkg: PackageJson | undefined): string[] | undefined => {
  if (Array.isArray(pkg?.workspaces)) {
    return pkg.workspaces
  }
  if (pkg?.workspaces?.packages) {
    return pkg.workspaces.packages
  }
  return undefined
}

const pnpmWorkspaceGlobs = (dir: string): string[] | undefined => {
  const file = join(dir, "pnpm-workspace.yaml")
  if (!existsSync(file)) {
    return undefined
  }
  const parsed = parseYaml(readFileSync(file, "utf8")) as {
    packages?: string[]
  } | null
  return parsed?.packages ?? []
}

const isMonorepoRoot = (dir: string): boolean => {
  return (
    existsSync(join(dir, "turbo.json")) ||
    existsSync(join(dir, "pnpm-workspace.yaml")) ||
    workspaceGlobs(readPackageJson(dir)) !== undefined
  )
}

/** Walks up from `cwd`. Returns the monorepo root, or the nearest package.json dir. */
const findRoot = (cwd: string): string => {
  let dir = resolve(cwd)
  let nearestPackage: string | undefined
  while (true) {
    if (isMonorepoRoot(dir)) {
      return dir
    }
    if (nearestPackage === undefined && existsSync(join(dir, "package.json"))) {
      nearestPackage = dir
    }
    const parent = dirname(dir)
    if (existsSync(join(dir, ".git")) || parent === dir) {
      break
    }
    dir = parent
  }
  if (nearestPackage === undefined) {
    throw new WeeError(
      "no-package-json",
      `No package.json found from ${cwd} upwards`
    )
  }
  return nearestPackage
}

const readTurboTasks = (root: string): string[] => {
  const file = join(root, "turbo.json")
  if (!existsSync(file)) {
    return []
  }
  const parsed = JSON.parse(readFileSync(file, "utf8")) as {
    tasks?: Record<string, unknown>
    pipeline?: Record<string, unknown>
  }
  return Object.keys(parsed.tasks ?? parsed.pipeline ?? {})
}

const listWorkspaces = async (
  root: string,
  globs: string[]
): Promise<Workspace[]> => {
  const dirs = await glob(globs, {
    cwd: root,
    onlyDirectories: true,
    ignore: ["**/node_modules/**"],
    absolute: true,
  })
  const workspaces: Workspace[] = []
  for (const dir of dirs.sort()) {
    const pkg = readPackageJson(dir)
    if (pkg?.name === undefined) {
      continue
    }
    workspaces.push({
      name: pkg.name,
      path: dir.replace(/[\\/]+$/, ""),
      isNextApp: hasDependency(pkg, "next"),
    })
  }
  return workspaces
}

const detectRepo = async (cwd: string): Promise<RepoInfo> => {
  const root = findRoot(cwd)
  const rootPackage = readPackageJson(root)
  const hasTurbo = existsSync(join(root, "turbo.json"))
  const globs = pnpmWorkspaceGlobs(root) ?? workspaceGlobs(rootPackage)
  const pm = await detectPackageManager(root)
  const packageManager: PackageManagerName = pm?.name ?? "npm"

  if (globs === undefined) {
    if (!hasDependency(rootPackage, "next")) {
      throw new WeeError(
        "no-next-app",
        `No Next.js app found: ${root}/package.json has no "next" dependency`
      )
    }
    return {
      root,
      shape: "single",
      hasTurbo,
      turboTasks: [],
      packageManager,
      workspaces: [],
    }
  }

  return {
    root,
    shape: hasTurbo ? "turborepo" : "workspaces",
    hasTurbo,
    turboTasks: readTurboTasks(root),
    packageManager,
    workspaces: await listWorkspaces(root, globs),
  }
}

export type { PackageJson, RepoInfo, RepoShape, Workspace }
export { detectRepo, hasDependency, readPackageJson }
