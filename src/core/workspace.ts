/**
 * Target selection inside a repo. Single repos target the root. Monorepos
 * take `--app` or `--package`, fall back to the only Next.js app, and
 * otherwise prompt (or fail with the candidate list in `--json` mode).
 */
import { isCancel, select } from "@clack/prompts"
import { WeeError } from "./errors.js"
import type { RepoInfo, Workspace } from "./repo.js"

type TargetKind = "app" | "package"

interface Target {
  name: string
  path: string
  kind: TargetKind
}

interface SelectTargetOptions {
  repo: RepoInfo
  app?: string | undefined
  pkg?: string | undefined
  json: boolean
  interactive: boolean
}

const findWorkspace = (
  repo: RepoInfo,
  name: string,
  kind: TargetKind
): Workspace => {
  const found = repo.workspaces.find((workspace) => workspace.name === name)
  if (found === undefined) {
    throw new WeeError("workspace-not-found", `No workspace named "${name}"`, {
      data: { candidates: repo.workspaces.map((workspace) => workspace.name) },
    })
  }
  if (kind === "app" && !found.isNextApp) {
    throw new WeeError(
      "not-a-next-app",
      `Workspace "${name}" has no "next" dependency`
    )
  }
  return found
}

const promptForApp = async (apps: Workspace[]): Promise<Workspace> => {
  const choice = await select({
    message: "Several Next.js apps found. Which one?",
    options: apps.map((app) => ({
      value: app.name,
      label: app.name,
      hint: app.path,
    })),
  })
  if (isCancel(choice)) {
    throw new WeeError("cancelled", "Cancelled", { exitCode: 130 })
  }
  const picked = apps.find((app) => app.name === choice)
  if (picked === undefined) {
    throw new WeeError(
      "workspace-not-found",
      `No workspace named "${String(choice)}"`
    )
  }
  return picked
}

const selectTarget = async (options: SelectTargetOptions): Promise<Target> => {
  const { repo, app, pkg, json, interactive } = options

  if (repo.shape === "single") {
    return { name: "root", path: repo.root, kind: "app" }
  }
  if (app !== undefined) {
    const workspace = findWorkspace(repo, app, "app")
    return { name: workspace.name, path: workspace.path, kind: "app" }
  }
  if (pkg !== undefined) {
    const workspace = findWorkspace(repo, pkg, "package")
    return { name: workspace.name, path: workspace.path, kind: "package" }
  }

  const apps = repo.workspaces.filter((workspace) => workspace.isNextApp)
  const candidates = apps.map((workspace) => workspace.name)
  if (apps.length === 0) {
    throw new WeeError("no-next-app", 'No workspace has a "next" dependency')
  }
  const only = apps[0]
  if (apps.length === 1 && only !== undefined) {
    return { name: only.name, path: only.path, kind: "app" }
  }
  if (json || !interactive) {
    throw new WeeError(
      "ambiguous-target",
      `Several Next.js apps found. Pass --app <name>. Candidates: ${candidates.join(", ")}`,
      {
        data: { candidates },
      }
    )
  }
  const picked = await promptForApp(apps)
  return { name: picked.name, path: picked.path, kind: "app" }
}

export type { Target, TargetKind }
export { selectTarget }
