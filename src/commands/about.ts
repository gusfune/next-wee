/** `wee about`: runtime, package manager and framework versions for the target app. */
import { x } from "tinyexec"
import { defineWeeCommand } from "../core/command.js"
import type { PackageJson } from "../core/repo.js"
import { readPackageJson } from "../core/repo.js"
import { appEnv } from "../lib/env.js"

const TRACKED_PACKAGES = [
  "next",
  "react",
  "drizzle-orm",
  "prisma",
  "inngest",
  "better-auth",
] as const

const dependencyVersion = (
  pkg: PackageJson | undefined,
  name: string
): string | undefined => {
  return pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name]
}

const bunVersion = async (): Promise<string | undefined> => {
  const result = await x("bun", ["--version"], { throwOnError: false })
  return result.exitCode === 0 ? result.stdout.trim() : undefined
}

const about = defineWeeCommand({
  meta: { name: "about", description: "Show versions and the resolved target" },
  run: async (ctx) => {
    const pkg = readPackageJson(ctx.target.path)
    const versions = Object.fromEntries(
      TRACKED_PACKAGES.map((name) => [
        name,
        dependencyVersion(pkg, name) ?? null,
      ])
    )
    return {
      data: {
        cli: ctx.cliVersion,
        node: process.versions.node,
        bun: (await bunVersion()) ?? null,
        packageManager: ctx.repo.packageManager,
        repoShape: ctx.repo.shape,
        repoRoot: ctx.repo.root,
        turboTasks: ctx.repo.turboTasks,
        target: ctx.target.name,
        targetPath: ctx.target.path,
        router: ctx.config.router,
        srcDir: ctx.config.srcDir,
        db: ctx.config.db?.adapter ?? null,
        auth: ctx.config.auth?.provider ?? null,
        jobs: ctx.config.jobs?.provider ?? null,
        appEnv: appEnv(),
        ...versions,
      },
    }
  },
})

export { about }
