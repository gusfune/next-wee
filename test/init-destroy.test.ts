import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ArgsDef, CommandDef } from "citty"
import { runCommand } from "citty"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { destroy } from "../src/commands/destroy.js"
import { init } from "../src/commands/init.js"
import { applyChanges } from "../src/core/changes.js"
import { writeManifest } from "../src/core/manifest.js"

const fixtures = join(import.meta.dirname, "..", "fixtures")

let app: string
let originalCwd: string
let stdout: string[]
let stderr: string[]

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

let restore: Array<() => void> = []

beforeEach(() => {
  app = mkdtempSync(join(tmpdir(), "wee-"))
  cpSync(join(fixtures, "single-repo"), app, { recursive: true })
  originalCwd = process.cwd()
  process.chdir(app)
  stdout = []
  stderr = []
  restore = [capture(process.stdout, stdout), capture(process.stderr, stderr)]
  process.exitCode = undefined
})

afterEach(() => {
  for (const fn of restore) {
    fn()
  }
  process.chdir(originalCwd)
  rmSync(app, { recursive: true, force: true })
  process.exitCode = undefined
})

const run = async <T extends ArgsDef>(
  command: CommandDef<T>,
  rawArgs: string[]
): Promise<{ out: string; err: string; exit: number }> => {
  stdout.length = 0
  stderr.length = 0
  process.exitCode = undefined
  await runCommand(command, { rawArgs })
  return {
    out: stdout.join(""),
    err: stderr.join(""),
    exit: process.exitCode === undefined ? 0 : Number(process.exitCode),
  }
}

describe("init", () => {
  it("writes config, conventions and a manifest", async () => {
    const { out, exit } = await run(init, ["--json"])
    expect(exit).toBe(0)
    expect(JSON.parse(out)).toEqual([
      { action: "create", path: ".app/config.json" },
      { action: "create", path: "CONVENTIONS.md" },
      { action: "manifest", path: ".app/manifests/init-app.json" },
    ])
    expect(
      JSON.parse(readFileSync(join(app, ".app/config.json"), "utf8"))
    ).toEqual({ router: "app", srcDir: true })
    expect(readFileSync(join(app, "CONVENTIONS.md"), "utf8")).toContain(
      "`src/db/schema/<plural>.ts`"
    )
  })

  it("writes nothing in --dry-run", async () => {
    const { exit } = await run(init, ["--dry-run"])
    expect(exit).toBe(0)
    expect(existsSync(join(app, ".app"))).toBe(false)
    expect(existsSync(join(app, "CONVENTIONS.md"))).toBe(false)
  })

  it("refuses a second run without --force", async () => {
    await run(init, [])
    const { err, exit } = await run(init, ["--json"])
    expect(exit).toBe(1)
    expect(JSON.parse(err).error.code).toBe("already-initialised")
  })
})

describe("destroy", () => {
  it("reverses init and prunes empty directories", async () => {
    await run(init, [])
    const { out, exit } = await run(destroy, ["init", "app", "--json"])
    expect(exit).toBe(0)
    expect(
      JSON.parse(out).map((row: { action: string }) => row.action)
    ).toEqual(["delete", "delete", "delete"])
    expect(existsSync(join(app, "CONVENTIONS.md"))).toBe(false)
    expect(existsSync(join(app, ".app"))).toBe(false)
  })

  it("refuses when a generated file changed, then obeys --force", async () => {
    await run(init, [])
    writeFileSync(join(app, "CONVENTIONS.md"), "edited\n")
    const first = await run(destroy, ["init", "app", "--json"])
    expect(first.exit).toBe(1)
    expect(JSON.parse(first.err).error).toMatchObject({
      code: "drift",
      data: {
        drift: [
          { path: "CONVENTIONS.md", reason: "modified since generation" },
        ],
      },
    })
    const second = await run(destroy, ["init", "app", "--force"])
    expect(second.exit).toBe(0)
    expect(existsSync(join(app, "CONVENTIONS.md"))).toBe(false)
  })

  it("removes injected blocks and restores modified files", async () => {
    const index = join(app, "src/db/schema/index.ts")
    writeFileSync(join(app, "src/app/layout.tsx"), "original\n")
    const applied = applyChanges({
      root: app,
      dryRun: false,
      changes: [
        {
          kind: "create",
          path: "src/db/schema/posts.ts",
          content: "export const posts = {}\n",
        },
        {
          kind: "inject",
          path: "src/db/schema/index.ts",
          marker: "model-post",
          content: "export * from './posts'",
        },
        { kind: "modify", path: "src/app/layout.tsx", content: "changed\n" },
      ],
    })
    writeManifest({
      targetPath: app,
      generator: "model",
      name: "Post",
      cliVersion: "test",
      changes: applied,
      dryRun: false,
    })
    expect(readFileSync(index, "utf8")).toContain("// wee:begin model-post")

    const { exit } = await run(destroy, ["model", "Post"])
    expect(exit).toBe(0)
    expect(existsSync(join(app, "src/db"))).toBe(false)
    expect(readFileSync(join(app, "src/app/layout.tsx"), "utf8")).toBe(
      "original\n"
    )
  })
})
