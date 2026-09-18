/**
 * Phase 5 acceptance: `wee new` scaffolds an app that `wee ci` runs green
 * on after `g resource Post`. The e2e step needs a browser and a dev
 * server; it runs when `WEE_E2E=1` (GitHub Actions sets it).
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ArgsDef, CommandDef } from "citty"
import { runCommand } from "citty"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { ci } from "../src/commands/ci.js"
import { dbInit } from "../src/commands/db.js"
import { resource } from "../src/commands/g/resource.js"
import { newApp } from "../src/commands/new.js"
import { lint, typecheck } from "../src/commands/quality.js"

const root = join(import.meta.dirname, "..")
const fixtures = join(root, "fixtures")
const originalCwd = process.cwd()

let stdout: string[] = []
let stderr: string[] = []

const capture = (stream: NodeJS.WriteStream, sink: string[]): (() => void) => {
  const original = stream.write.bind(stream)
  stream.write = ((chunk: string | Uint8Array) => {
    sink.push(String(chunk))
    return true
  }) as typeof stream.write
  return () => {
    stream.write = original
  }
}

interface Result {
  out: string
  err: string
  exit: number
}

interface Row {
  action?: string
  path?: string
  step?: string
  status?: string
}

const run = async <T extends ArgsDef>(
  command: CommandDef<T>,
  rawArgs: string[]
): Promise<Result> => {
  stdout = []
  stderr = []
  const restore = [
    capture(process.stdout, stdout),
    capture(process.stderr, stderr),
  ]
  process.exitCode = undefined
  try {
    await runCommand(command, { rawArgs: [...rawArgs, "--json"] })
  } finally {
    for (const fn of restore) {
      fn()
    }
  }
  const result = {
    out: stdout.join(""),
    err: stderr.join(""),
    exit: process.exitCode === undefined ? 0 : Number(process.exitCode),
  }
  process.exitCode = undefined
  return result
}

const ok = async <T extends ArgsDef>(
  command: CommandDef<T>,
  rawArgs: string[]
): Promise<Row[]> => {
  const result = await run(command, rawArgs)
  expect(result.err).toBe("")
  expect(result.exit).toBe(0)
  return JSON.parse(result.out) as Row[]
}

const scratch = (): string => mkdtempSync(join(tmpdir(), "wee-ops-"))

const json = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T

interface PackageJson {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  workspaces?: string[]
}

describe("wee new", () => {
  let dir: string

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(dir, { recursive: true, force: true })
  })

  it("scaffolds a standalone app with a workflow and a git repo", async () => {
    dir = scratch()
    process.chdir(dir)
    const rows = await ok(newApp, [
      "blog",
      "--db=drizzle",
      "--auth=placeholder",
      "--skip-install",
    ])
    const app = join(dir, "blog")
    for (const file of [
      "package.json",
      "tsconfig.json",
      "next.config.ts",
      "biome.json",
      "vitest.config.ts",
      "playwright.config.ts",
      "src/app/layout.tsx",
      "src/app/page.tsx",
      "src/app/page.test.tsx",
      "src/components/nav.tsx",
      "src/env.ts",
      ".env.example",
      ".gitignore",
      "README.md",
      "AGENTS.md",
      "CONVENTIONS.md",
      ".app/config.json",
      "config/ci.ts",
      "e2e/smoke.spec.ts",
      ".github/workflows/ci.yml",
      ".git",
    ]) {
      expect(existsSync(join(app, file)), file).toBe(true)
    }
    expect(rows.map((row) => row.action)).toContain("git")
    const pkg = json<PackageJson>(join(app, "package.json"))
    expect(pkg.scripts?.ci).toBe("wee ci")
    expect(pkg.devDependencies?.["@playwright/test"]).toMatch(/^\d/)
    expect(readFileSync(join(app, "src/app/layout.tsx"), "utf8")).toContain(
      "<Nav />"
    )
    expect(readFileSync(join(app, "config/ci.ts"), "utf8")).toContain(
      '"test:e2e",'
    )
    // --db and --auth ran inside the new app.
    expect(existsSync(join(app, "drizzle.config.ts"))).toBe(true)
    expect(existsSync(join(app, "src/lib/auth/index.ts"))).toBe(true)
    expect(
      json<{ db?: { adapter: string }; auth?: { provider: string } }>(
        join(app, ".app/config.json")
      )
    ).toMatchObject({
      db: { adapter: "drizzle", provider: "postgres" },
      auth: { provider: "placeholder" },
    })
  })

  it("--api --minimal writes a health route, no nav, no Playwright", async () => {
    dir = scratch()
    process.chdir(dir)
    await ok(newApp, ["svc", "--api", "--minimal", "--skip-install"])
    const app = join(dir, "svc")
    expect(existsSync(join(app, "src/app/api/health/route.ts"))).toBe(true)
    expect(existsSync(join(app, "src/components/nav.tsx"))).toBe(false)
    expect(existsSync(join(app, "playwright.config.ts"))).toBe(false)
    expect(existsSync(join(app, "e2e"))).toBe(false)
    const pkg = json<PackageJson>(join(app, "package.json"))
    expect(pkg.scripts?.["test:e2e"]).toBeUndefined()
    expect(pkg.devDependencies?.["@playwright/test"]).toBeUndefined()
    expect(readFileSync(join(app, "config/ci.ts"), "utf8")).not.toContain(
      '"test:e2e",'
    )
  })

  it("refuses --minimal with --auth and a non-empty directory", async () => {
    dir = scratch()
    process.chdir(dir)
    const conflict = await run(newApp, ["x", "--minimal", "--auth=placeholder"])
    expect(conflict.exit).toBe(1)
    expect(conflict.err).toContain("flag-conflict")
    mkdirSync(join(dir, "taken"))
    writeFileSync(join(dir, "taken", "a.txt"), "a")
    const taken = await run(newApp, ["taken", "--skip-install"])
    expect(taken.exit).toBe(1)
    expect(taken.err).toContain("dir-exists")
    const bad = await run(newApp, ["Bad Name", "--skip-install"])
    expect(bad.err).toContain("invalid-name")
  })

  it("places the app under apps/ in a monorepo and registers the workspace", async () => {
    dir = scratch()
    writeFileSync(
      join(dir, "package.json"),
      '{ "name": "mono", "private": true, "workspaces": ["packages/*"] }\n'
    )
    mkdirSync(join(dir, "packages"))
    process.chdir(dir)
    const rows = await ok(newApp, ["web", "--skip-install"])
    expect(existsSync(join(dir, "apps", "web", "package.json"))).toBe(true)
    expect(existsSync(join(dir, "apps", "web", ".github"))).toBe(false)
    expect(rows).toContainEqual({ action: "modify", path: "package.json" })
    expect(json<PackageJson>(join(dir, "package.json")).workspaces).toEqual([
      "packages/*",
      "apps/*",
    ])
  })

  it("keeps pnpm-workspace.yaml when apps/* is already listed", async () => {
    dir = scratch()
    cpSync(join(fixtures, "pnpm-mono"), dir, { recursive: true })
    process.chdir(dir)
    const rows = await ok(newApp, ["admin", "--skip-install"])
    expect(existsSync(join(dir, "apps", "admin", "package.json"))).toBe(true)
    expect(rows.map((row) => row.path)).not.toContain("pnpm-workspace.yaml")
  })
})

describe("wee lint without a linter", () => {
  it("fails with linter-missing", async () => {
    const dir = scratch()
    cpSync(join(fixtures, "single-repo"), dir, { recursive: true })
    process.chdir(dir)
    const result = await run(lint, [])
    process.chdir(originalCwd)
    rmSync(dir, { recursive: true, force: true })
    expect(result.exit).toBe(1)
    expect(result.err).toContain("linter-missing")
  })
})

const E2E = process.env.WEE_E2E === "1"

describe("wee ci on the resource app", () => {
  let dir: string
  let app: string

  beforeAll(async () => {
    // Under the repo, not in tmpdir: Turbopack refuses a node_modules
    // symlink that points outside the workspace that holds the lockfile.
    mkdirSync(join(root, ".scratch"), { recursive: true })
    dir = mkdtempSync(join(root, ".scratch", "wee-ops-"))
    process.chdir(dir)
    await ok(newApp, ["blog", "--skip-install"])
    app = join(dir, "blog")
    process.chdir(app)
    symlinkSync(join(root, "node_modules"), join(app, "node_modules"))
    writeFileSync(join(app, ".env"), "DATABASE_URL=./local.sqlite\n")
    cpSync(
      join(root, "test", "better-sqlite3.d.ts"),
      join(app, "src", "better-sqlite3.d.ts")
    )
    await ok(dbInit, [
      "--adapter=drizzle",
      "--provider=sqlite",
      "--skip-install",
    ])
    const pkgFile = join(app, "package.json")
    const pkg = json<PackageJson>(pkgFile)
    pkg.dependencies = { ...pkg.dependencies, "drizzle-orm": "0.45.2" }
    // The symlinked node_modules has no `wee` bin: Playwright's dev server
    // starts the CLI from source instead.
    pkg.scripts = {
      ...pkg.scripts,
      dev: `node --import tsx ${join(root, "src", "cli.ts")} dev`,
    }
    writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`)
    await ok(resource, ["Post", "title:string", "body:text", "--skip-install"])
    if (!E2E) {
      writeFileSync(
        join(app, "config", "ci.ts"),
        'const steps = ["lint", "typecheck", "test", "build"]\n\nexport { steps }\n'
      )
    }
  }, 60_000)

  afterAll(() => {
    process.chdir(originalCwd)
    rmSync(dir, { recursive: true, force: true })
  })

  it("typecheck runs next typegen then tsc", async () => {
    await ok(typecheck, [])
    expect(existsSync(join(app, "next-env.d.ts"))).toBe(true)
  }, 120_000)

  it("ci runs every step from config/ci.ts and reports each one", async () => {
    process.env.PORT = "3117"
    const result = await run(ci, [])
    delete process.env.PORT
    expect(result.err).toBe("")
    expect(result.exit).toBe(0)
    const rows = JSON.parse(result.out) as Row[]
    expect(rows.map((row) => `${row.step}:${row.status}`)).toEqual([
      "lint:ok",
      "typecheck:ok",
      "test:ok",
      ...(E2E ? ["test:e2e:ok"] : []),
      "build:ok",
    ])
  }, 600_000)

  it("ci stops at the first failing step", async () => {
    writeFileSync(
      join(app, "config", "ci.ts"),
      'const steps = [{ name: "boom", command: "exit 3" }, "lint"]\n\nexport { steps }\n'
    )
    const result = await run(ci, [])
    expect(result.exit).toBe(3)
    const error = JSON.parse(result.err) as {
      error: { code: string; data: { steps: Row[] } }
    }
    expect(error.error.code).toBe("ci-failed")
    expect(error.error.data.steps).toEqual([
      { step: "boom", status: "failed", duration: expect.any(String) },
    ])
  }, 30_000)
})
