/**
 * `db:init` without `--skip-install` resolves the package list before it
 * writes files. Prisma refused its own freshly written `prisma.config.ts`
 * when the list was resolved afterwards. The install itself is stubbed.
 */
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCommand } from "citty"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const installed = vi.hoisted(() => ({ calls: [] as string[][] }))

vi.mock("../src/lib/packages.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/packages.js")>()
  return {
    ...actual,
    installPackages: async (options: {
      dependencies: string[]
      devDependencies: string[]
    }) => {
      installed.calls.push([
        ...options.dependencies,
        ...options.devDependencies,
      ])
    },
  }
})

const { dbInit } = await import("../src/commands/db.js")

const fixtures = join(import.meta.dirname, "..", "fixtures")
let app: string
let originalCwd: string

beforeEach(() => {
  app = mkdtempSync(join(tmpdir(), "wee-install-"))
  cpSync(join(fixtures, "single-repo"), app, { recursive: true })
  originalCwd = process.cwd()
  process.chdir(app)
  installed.calls = []
  process.exitCode = undefined
})

afterEach(() => {
  process.chdir(originalCwd)
  rmSync(app, { recursive: true, force: true })
  process.exitCode = undefined
})

describe("db:init installs after writing", () => {
  it.each(["prisma", "drizzle"])("%s", async (adapter) => {
    const write = process.stdout.write.bind(process.stdout)
    process.stdout.write = (() => true) as typeof process.stdout.write
    try {
      await runCommand(dbInit, {
        rawArgs: [`--adapter=${adapter}`, "--provider=sqlite", "--json"],
      })
    } finally {
      process.stdout.write = write
    }
    expect(process.exitCode ?? 0).toBe(0)
    expect(installed.calls).toHaveLength(1)
    expect(installed.calls[0]?.length).toBeGreaterThan(0)
  })
})
