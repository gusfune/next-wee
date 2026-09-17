import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { GlobalFlags } from "../src/core/context.js"
import { assertAppRouter, buildContext } from "../src/core/context.js"

const fixtures = join(import.meta.dirname, "..", "fixtures")

const flags = (overrides: Partial<GlobalFlags> = {}): GlobalFlags => ({
  dryRun: false,
  json: true,
  force: false,
  ...overrides,
})

describe("buildContext", () => {
  it("targets the root of a single repo", async () => {
    const ctx = await buildContext({
      cwd: join(fixtures, "single-repo"),
      flags: flags(),
    })
    expect(ctx.repo.shape).toBe("single")
    expect(ctx.target.path).toBe(join(fixtures, "single-repo"))
    expect(ctx.config.srcDir).toBe(true)
    expect(ctx.config.router).toBe("app")
  })

  it("reads workspaces and turbo tasks in a Turborepo", async () => {
    const ctx = await buildContext({
      cwd: join(fixtures, "turborepo"),
      flags: flags({ app: "web" }),
    })
    expect(ctx.repo.shape).toBe("turborepo")
    expect(ctx.repo.turboTasks).toEqual(["dev", "build", "test", "lint"])
    expect(ctx.repo.workspaces.map((workspace) => workspace.name)).toEqual([
      "admin",
      "web",
      "ui",
    ])
    expect(ctx.target.path).toBe(join(fixtures, "turborepo", "apps", "web"))
    expect(ctx.config.srcDir).toBe(false)
  })

  it("finds the root from a nested directory and loads the app config", async () => {
    const cwd = join(fixtures, "turborepo", "apps", "admin", "src", "app")
    const ctx = await buildContext({ cwd, flags: flags({ app: "admin" }) })
    expect(ctx.repo.root).toBe(join(fixtures, "turborepo"))
    expect(ctx.config.db?.adapter).toBe("drizzle")
    expect(ctx.hasConfigFile).toBe(true)
  })

  it("fails with the candidate list when several apps match in --json mode", async () => {
    await expect(
      buildContext({ cwd: join(fixtures, "turborepo"), flags: flags() })
    ).rejects.toMatchObject({
      code: "ambiguous-target",
      data: { candidates: ["admin", "web"] },
    })
  })

  it("targets a shared package with --package", async () => {
    const ctx = await buildContext({
      cwd: join(fixtures, "turborepo"),
      flags: flags({ pkg: "ui" }),
    })
    expect(ctx.target).toEqual({
      name: "ui",
      path: join(fixtures, "turborepo", "packages", "ui"),
      kind: "package",
    })
  })

  it("rejects --app on a workspace without next", async () => {
    await expect(
      buildContext({
        cwd: join(fixtures, "turborepo"),
        flags: flags({ app: "ui" }),
      })
    ).rejects.toMatchObject({
      code: "not-a-next-app",
    })
  })

  it("selects the only app in a pnpm workspace", async () => {
    const ctx = await buildContext({
      cwd: join(fixtures, "pnpm-mono"),
      flags: flags(),
    })
    expect(ctx.repo.shape).toBe("workspaces")
    expect(ctx.repo.packageManager).toBe("pnpm")
    expect(ctx.target.name).toBe("web")
  })

  it("detects the Pages Router and refuses generators", async () => {
    const ctx = await buildContext({
      cwd: join(fixtures, "pages-router"),
      flags: flags(),
    })
    expect(ctx.config.router).toBe("pages")
    expect(() => assertAppRouter(ctx)).toThrowError(/App Router only/)
  })
})
