/**
 * `wee new <name>`: a Next.js App Router app with wee's conventions
 * already in place. Standalone in `./<name>`, or `apps/<name>` inside a
 * monorepo. `--db` and `--auth` run `db:init` and `g auth` in the new app
 * after the install.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { defineCommand } from "citty"
import type { PackageManagerName } from "nypm"
import { installDependencies } from "nypm"
import { x } from "tinyexec"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import pkg from "../../package.json" with { type: "json" }
import type { FileChange } from "../core/changes.js"
import { applyChanges, describeChanges } from "../core/changes.js"
import { globalArgs } from "../core/command.js"
import { CONFIG_DIR, CONFIG_FILE } from "../core/config.js"
import type { Context, GlobalFlags } from "../core/context.js"
import { buildContext } from "../core/context.js"
import { WeeError } from "../core/errors.js"
import type { Row } from "../core/output.js"
import { emit, reportError } from "../core/output.js"
import { detectRepo, findMonorepoRoot, readPackageJson } from "../core/repo.js"
import { bunVersion } from "../lib/packages.js"
import { agentsTemplate } from "../templates/agents.md.js"
import { envTemplate } from "../templates/app.js"
import { conventionsTemplate } from "../templates/conventions.md.js"
import type { NewAppOptions } from "../templates/new.js"
import {
  biomeTemplate,
  envExampleTemplate,
  gitignoreTemplate,
  healthRouteTemplate,
  healthRouteTestTemplate,
  homePageTemplate,
  homePageTestTemplate,
  layoutTemplate,
  nextConfigTemplate,
  packageJsonTemplate,
  readmeTemplate,
  smokeSpecTemplate,
  tsconfigTemplate,
  vitestConfigTemplate,
} from "../templates/new.js"
import {
  CI_STEPS,
  ciConfigTemplate,
  playwrightConfigTemplate,
  workflowTemplate,
} from "../templates/ops.js"
import { navTemplate } from "../templates/resource.js"
import { runDbInit } from "./db.js"
import { runAuth } from "./g/auth.js"

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/

const parseName = (raw: string | undefined): string => {
  if (raw === undefined || !NAME_PATTERN.test(raw)) {
    throw new WeeError(
      "invalid-name",
      "Give a lowercase package name: letters, digits, dots, dashes and underscores."
    )
  }
  return raw
}

interface Placement {
  /** Absolute directory of the new app. */
  dir: string
  /** Path relative to the repo root or cwd, for output rows. */
  rel: string
  monorepoRoot: string | undefined
  pm: PackageManagerName
}

const inGitRepo = async (cwd: string): Promise<boolean> => {
  const result = await x("git", ["rev-parse", "--is-inside-work-tree"], {
    nodeOptions: { cwd },
    throwOnError: false,
  })
  return result.exitCode === 0
}

/** `apps/<name>` inside a monorepo, else `./<name>`. A non-empty target directory is an error. */
const place = async (cwd: string, name: string): Promise<Placement> => {
  const monorepoRoot = findMonorepoRoot(cwd)
  const dir =
    monorepoRoot === undefined
      ? resolve(cwd, name)
      : join(monorepoRoot, "apps", name)
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new WeeError("dir-exists", `${dir} exists and is not empty.`)
  }
  const pm =
    monorepoRoot === undefined
      ? (await bunVersion()) === undefined
        ? "npm"
        : "bun"
      : (await detectRepo(monorepoRoot)).packageManager
  return {
    dir,
    rel: monorepoRoot === undefined ? name : join("apps", name),
    monorepoRoot,
    pm,
  }
}

const file = (path: string, content: string): FileChange => ({
  kind: "create",
  path,
  content,
})

interface AppFilesOptions extends NewAppOptions {
  standalone: boolean
  bun: string | undefined
}

const appFiles = (options: AppFilesOptions): FileChange[] => {
  const { name, pm, api, minimal, standalone } = options
  const steps = CI_STEPS.filter((step) => !minimal || step !== "test:e2e")
  return [
    file("package.json", packageJsonTemplate(options)),
    file("tsconfig.json", tsconfigTemplate()),
    file("next.config.ts", nextConfigTemplate()),
    file("biome.json", biomeTemplate()),
    file("vitest.config.ts", vitestConfigTemplate()),
    file("src/app/layout.tsx", layoutTemplate(options)),
    ...(api
      ? [
          file("src/app/api/health/route.ts", healthRouteTemplate()),
          file("src/app/api/health/route.test.ts", healthRouteTestTemplate()),
        ]
      : [
          file("src/app/page.tsx", homePageTemplate(name)),
          file("src/app/page.test.tsx", homePageTestTemplate(name)),
          file("src/components/nav.tsx", navTemplate()),
        ]),
    file("src/env.ts", envTemplate()),
    file(".env.example", envExampleTemplate()),
    file(".gitignore", gitignoreTemplate()),
    file("README.md", readmeTemplate(options)),
    file("AGENTS.md", agentsTemplate(pm)),
    file(
      "CONVENTIONS.md",
      conventionsTemplate({ router: "app", srcDir: true })
    ),
    file(
      join(CONFIG_DIR, CONFIG_FILE),
      `${JSON.stringify({ router: "app", srcDir: true }, null, 2)}\n`
    ),
    file(join("config", "ci.ts"), ciConfigTemplate(steps)),
    ...(minimal
      ? []
      : [
          file("playwright.config.ts", playwrightConfigTemplate(pm)),
          file(join("e2e", "smoke.spec.ts"), smokeSpecTemplate(api)),
        ]),
    ...(standalone
      ? [
          file(
            join(".github", "workflows", "ci.yml"),
            workflowTemplate({ pm, e2e: !minimal, bunVersion: options.bun })
          ),
        ]
      : []),
  ]
}

/** Adds `apps/*` to the root workspace list when no pattern covers `apps/<name>`. */
const registerWorkspace = (root: string, dryRun: boolean): Row | undefined => {
  const yamlFile = join(root, "pnpm-workspace.yaml")
  if (existsSync(yamlFile)) {
    const doc = (parseYaml(readFileSync(yamlFile, "utf8")) ?? {}) as {
      packages?: string[]
    }
    const packages = doc.packages ?? []
    if (packages.includes("apps/*")) {
      return undefined
    }
    if (!dryRun) {
      writeFileSync(
        yamlFile,
        stringifyYaml({ ...doc, packages: [...packages, "apps/*"] })
      )
    }
    return { action: "modify", path: "pnpm-workspace.yaml" }
  }
  const pkgFile = join(root, "package.json")
  const rootPkg = readPackageJson(root) ?? {}
  const raw = rootPkg.workspaces
  const list = Array.isArray(raw) ? raw : (raw?.packages ?? [])
  if (list.includes("apps/*")) {
    return undefined
  }
  const workspaces =
    Array.isArray(raw) || raw === undefined
      ? [...list, "apps/*"]
      : { ...raw, packages: [...list, "apps/*"] }
  if (!dryRun) {
    writeFileSync(
      pkgFile,
      `${JSON.stringify({ ...rootPkg, workspaces }, null, 2)}\n`
    )
  }
  return { action: "modify", path: "package.json" }
}

const newArgs = {
  name: { type: "positional", description: "App name", required: true },
  api: {
    type: "boolean",
    description: "API only: health route, no pages",
    default: false,
  },
  minimal: {
    type: "boolean",
    description: "No Playwright and no e2e folder",
    default: false,
  },
  db: { type: "string", description: "Run db:init with this adapter" },
  auth: { type: "string", description: "Run g auth with this provider" },
  "skip-install": {
    type: "boolean",
    description: "Write files only",
    default: false,
  },
  // No --app or --package: the target does not exist yet.
  "dry-run": globalArgs["dry-run"],
  json: globalArgs.json,
  force: globalArgs.force,
} as const

interface FollowUpOptions {
  dir: string
  flags: GlobalFlags
  db: string | undefined
  auth: string | undefined
  skipInstall: boolean
}

/** `db:init` and `g auth` inside the new app, through a Context built there. */
const followUps = async (options: FollowUpOptions): Promise<Row[]> => {
  const { dir, flags, db, auth, skipInstall } = options
  if (db === undefined && auth === undefined) {
    return []
  }
  const ctx: Context = await buildContext({
    cwd: dir,
    flags: { ...flags, app: undefined, pkg: undefined },
  })
  const rows: Row[] = []
  const collect = (data: Row[] | Row): void => {
    rows.push(...(Array.isArray(data) ? data : [data]))
  }
  if (db !== undefined) {
    const result = await runDbInit(ctx, {
      adapter: db,
      "skip-install": skipInstall,
    })
    collect(result.data)
  }
  if (auth !== undefined) {
    // Reload: `db:init` just wrote the db section that g auth reads.
    const fresh = await buildContext({ cwd: dir, flags: ctx.flags })
    const result = await runAuth(fresh, {
      _: [],
      provider: auth,
      "skip-install": skipInstall,
    })
    collect(result.data)
  }
  return rows
}

const newCommand = defineCommand({
  meta: {
    name: "new",
    description: "Create a Next.js app with wee's conventions",
  },
  args: newArgs,
  run: async ({ args }) => {
    const flags: GlobalFlags = {
      dryRun: args["dry-run"],
      json: args.json,
      force: args.force,
    }
    try {
      const name = parseName(args.name)
      if (args.minimal && args.auth !== undefined) {
        throw new WeeError(
          "flag-conflict",
          "--minimal has no e2e or sign-in flow; drop --auth or --minimal."
        )
      }
      const cwd = process.cwd()
      const placement = await place(cwd, name)
      const standalone = placement.monorepoRoot === undefined
      const changes = appFiles({
        name,
        pm: placement.pm,
        api: args.api,
        minimal: args.minimal,
        standalone,
        bun: placement.pm === "bun" ? await bunVersion() : undefined,
      })
      applyChanges({ root: placement.dir, changes, dryRun: flags.dryRun })
      const rows: Row[] = describeChanges(changes).map((row) => ({
        ...row,
        path: join(placement.rel, row.path),
      }))
      if (placement.monorepoRoot !== undefined) {
        const registered = registerWorkspace(
          placement.monorepoRoot,
          flags.dryRun
        )
        if (registered !== undefined) {
          rows.push(registered)
        }
      } else if (!flags.dryRun && !(await inGitRepo(cwd))) {
        await x("git", ["init", "-q"], { nodeOptions: { cwd: placement.dir } })
        rows.push({ action: "git", path: `${placement.rel}/.git` })
      }
      if (flags.dryRun) {
        emit({ json: flags.json, data: rows, title: `new ${name} (dry run)` })
        return
      }
      if (!args["skip-install"]) {
        await installDependencies({
          cwd: placement.monorepoRoot ?? placement.dir,
          packageManager: placement.pm,
          silent: flags.json,
        })
        rows.push({ action: "install", path: placement.pm })
      }
      rows.push(
        ...(await followUps({
          dir: placement.dir,
          flags,
          db: args.db,
          auth: args.auth,
          skipInstall: args["skip-install"],
        }))
      )
      emit({
        json: flags.json,
        data: rows,
        title: `new ${name} (wee ${pkg.version})`,
      })
    } catch (error) {
      process.exitCode = reportError(error, flags.json)
    }
  },
})

export { newCommand as newApp }
