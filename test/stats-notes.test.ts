import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { ArgsDef, CommandDef } from "citty"
import { runCommand } from "citty"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { notes } from "../src/commands/notes.js"
import { stats } from "../src/commands/stats.js"
import { classifyPrimitive } from "../src/lib/primitives.js"

const fixtures = join(import.meta.dirname, "..", "fixtures")

let app: string
let originalCwd: string
let stdout: string[]
let stderr: string[]
let restore: Array<() => void> = []

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

beforeEach(() => {
  app = mkdtempSync(join(tmpdir(), "wee-stats-"))
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
  await runCommand(command, { rawArgs: [...rawArgs, "--json"] })
  return {
    out: stdout.join(""),
    err: stderr.join(""),
    exit: process.exitCode === undefined ? 0 : Number(process.exitCode),
  }
}

const write = (path: string, content: string): void => {
  const file = join(app, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

/** Files with a known line count: `service` has 6 lines, 3 of them code. */
const seed = (): void => {
  write(
    "src/services/posts.ts",
    [
      "/**",
      " * Posts service.",
      " */",
      "",
      "// TODO: paginate",
      "export const listPosts = () => []",
      "",
    ].join("\n")
  )
  write("src/services/posts.test.ts", "test('x', () => {})\nexpect(1)\n")
  write("src/app/posts/page.tsx", "export default () => null\n")
  write(
    "src/components/posts/post-form.tsx",
    "export const PostForm = () => null\n"
  )
  write(
    "e2e/posts.spec.ts",
    "// FIXME flaky\ntest('posts', async () => {})\n\nexpect(1)\n"
  )
  write("README.md", "# App\n\n<!-- OPTIMISE: later -->\n")
}

describe("classifyPrimitive", () => {
  it("resolves the ambiguous paths", () => {
    expect(classifyPrimitive("lib/auth/index.ts")).toBe("auth")
    expect(classifyPrimitive("lib/display.ts")).toBe("helper")
    expect(classifyPrimitive("lib/validators/post.ts")).toBe("validator")
    expect(classifyPrimitive("components/providers/theme-provider.tsx")).toBe(
      "provider"
    )
    expect(classifyPrimitive("components/posts/post-form.tsx")).toBe("form")
    expect(classifyPrimitive("components/posts/post-card.tsx")).toBe(
      "component"
    )
    expect(classifyPrimitive("app/(marketing)/layout.tsx")).toBe("layout")
    expect(classifyPrimitive("app/posts/[id]/loading.tsx")).toBe("boundary")
    expect(classifyPrimitive("app/api/posts/route.ts")).toBe("handler")
    expect(classifyPrimitive("app/opengraph-image.tsx")).toBe("metadata")
    expect(classifyPrimitive("services/posts.test.ts")).toBe("test")
    expect(classifyPrimitive("e2e/posts.spec.ts")).toBe("e2e")
    expect(classifyPrimitive("db/seed.ts")).toBe("seed")
    expect(classifyPrimitive("app/posts/helpers.ts")).toBeUndefined()
    expect(classifyPrimitive("better-sqlite3.d.ts")).toBeUndefined()
  })
})

describe("stats", () => {
  it("counts files, lines and loc per primitive and reports the ratio", async () => {
    seed()
    const { out, exit, err } = await run(stats, [])
    expect(err).toBe("")
    expect(exit).toBe(0)
    const data = JSON.parse(out) as {
      primitives: {
        primitive: string
        files: number
        lines: number
        loc: number
      }[]
      code: number
      tests: number
      ratio: string
    }
    expect(data.primitives).toEqual([
      { primitive: "service", files: 1, lines: 6, loc: 1 },
      { primitive: "page", files: 1, lines: 1, loc: 1 },
      { primitive: "layout", files: 1, lines: 1, loc: 1 },
      { primitive: "form", files: 1, lines: 1, loc: 1 },
      { primitive: "test", files: 1, lines: 2, loc: 2 },
      { primitive: "e2e", files: 1, lines: 4, loc: 2 },
      { primitive: "total", files: 6, lines: 15, loc: 8 },
    ])
    expect(data.code).toBe(4)
    expect(data.tests).toBe(4)
    expect(data.ratio).toBe("1:1")
  })

  it("prints a title with the ratio in human mode", async () => {
    seed()
    stdout.length = 0
    await runCommand(stats, { rawArgs: [] })
    const out = stdout.join("")
    expect(out).toContain("code 4 · tests 4 · ratio 1:1")
    expect(out).toContain("total")
  })
})

describe("notes", () => {
  it("lists annotations sorted by file and line", async () => {
    seed()
    const { out, exit } = await run(notes, [])
    expect(exit).toBe(0)
    expect(JSON.parse(out)).toEqual([
      { file: "README.md", line: 3, tag: "OPTIMISE", text: "later" },
      { file: "e2e/posts.spec.ts", line: 1, tag: "FIXME", text: "flaky" },
      { file: "src/services/posts.ts", line: 5, tag: "TODO", text: "paginate" },
    ])
  })

  it("returns an empty list when nothing is annotated", async () => {
    const { out, exit } = await run(notes, [])
    expect(exit).toBe(0)
    expect(JSON.parse(out)).toEqual([])
  })
})
