/**
 * Phase 3 acceptance: `g resource Post` emits the whole CRUD flow in one
 * manifest, the result typechecks and its unit tests pass, `routes` lists
 * the four pages, `runner` evaluates against the migrated database, and
 * `destroy resource Post` returns the tree to its baseline. `g resource
 * Comment --api` writes REST handlers instead of the UI and the handlers
 * answer against the migrated database through the runner. The generated
 * Playwright spec needs a browser and a dev server; Phase 5 `test:e2e`
 * runs it.
 */
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import type { ArgsDef, CommandDef } from "citty"
import { runCommand } from "citty"
import { x } from "tinyexec"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { dbInit, dbMigrate } from "../src/commands/db.js"
import { destroy } from "../src/commands/destroy.js"
import { form } from "../src/commands/g/form.js"
import { resource } from "../src/commands/g/resource.js"
import { routes } from "../src/commands/routes.js"

const root = join(import.meta.dirname, "..")
const fixtures = join(root, "fixtures")

let app: string
let originalCwd: string
let baseline: string[] = []
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
): Promise<Result> => {
  const result = await run(command, rawArgs)
  expect(result.err).toBe("")
  expect(result.exit).toBe(0)
  return result
}

const read = (path: string): string => readFileSync(join(app, path), "utf8")
const has = (path: string): boolean => existsSync(join(app, path))

const tree = (dir = app): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.name === "node_modules" || entry.name === "local.sqlite") {
        return []
      }
      const full = join(dir, entry.name)
      return entry.isDirectory() ? tree(full) : [relative(app, full)]
    })
    .sort()

const TSCONFIG = {
  compilerOptions: {
    target: "es2022",
    lib: ["dom", "dom.iterable", "esnext"],
    module: "esnext",
    moduleResolution: "bundler",
    jsx: "react-jsx",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    isolatedModules: true,
    esModuleInterop: true,
    noUncheckedIndexedAccess: true,
    types: ["node"],
  },
  // e2e/ needs @playwright/test, which --skip-install leaves out.
  include: ["src"],
}

const enterApp = (): void => {
  app = mkdtempSync(join(tmpdir(), "wee-resource-"))
  cpSync(join(fixtures, "single-repo"), app, { recursive: true })
  symlinkSync(join(root, "node_modules"), join(app, "node_modules"))
  writeFileSync(join(app, ".env"), "DATABASE_URL=./local.sqlite\n")
  writeFileSync(
    join(app, "tsconfig.json"),
    `${JSON.stringify(TSCONFIG, null, 2)}\n`
  )
  cpSync(
    join(root, "test", "better-sqlite3.d.ts"),
    join(app, "src", "better-sqlite3.d.ts")
  )
  originalCwd = process.cwd()
  process.chdir(app)
}

const leaveApp = (): void => {
  process.chdir(originalCwd)
  rmSync(app, { recursive: true, force: true })
}

interface Exec {
  output: string
  exitCode: number | undefined
}

const exec = async (args: string[]): Promise<Exec> => {
  const result = await x("node", args, {
    nodeOptions: { cwd: app },
    throwOnError: false,
  })
  return {
    output: `${result.stdout}${result.stderr}`,
    exitCode: result.exitCode,
  }
}

/** The CLI as a child process, for commands that inherit stdio. */
const cli = (args: string[]): Promise<Exec> =>
  exec(["--import", "tsx", join(root, "src/cli.ts"), ...args])

/**
 * Runner script that calls the generated REST handlers end to end: create,
 * list, show, update, delete, plus the 400 and 404 paths. Handlers take a
 * `NextRequest`; a plain `Request` carries the same `url` and `json()`.
 */
const API_CHECK = `import { DELETE, GET, PATCH } from "./src/app/api/comments/[id]/route"
import { GET as listComments, POST } from "./src/app/api/comments/route"

const request = (method: string, url: string, body?: unknown): Request =>
  new Request(url, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const expect = (condition: boolean, label: string): void => {
  if (!condition) {
    throw new Error(label)
  }
}

export default async (): Promise<boolean> => {
  const url = "http://test/api/comments"

  const bad = await POST(request("POST", url, { body: 123 }))
  expect(bad.status === 400, "POST with a wrong field answers 400")

  const created = await POST(request("POST", url, { body: "first" }))
  expect(created.status === 201, "POST answers 201")
  const row = (await created.json()) as { id: string }

  const collection = await listComments(request("GET", url))
  expect(collection.status === 200, "GET collection answers 200")
  const page = (await collection.json()) as { total: number }
  expect(page.total === 1, "collection lists the created row")

  const ctx = { params: Promise.resolve({ id: row.id }) }
  const shown = await GET(request("GET", url), ctx)
  expect(shown.status === 200, "GET member answers 200")

  const missing = { params: Promise.resolve({ id: "missing" }) }
  const absent = await GET(request("GET", url), missing)
  expect(absent.status === 404, "GET member answers 404 for a missing id")

  const patched = await PATCH(request("PATCH", url, { body: "updated" }), ctx)
  expect(patched.status === 200, "PATCH answers 200")
  const updated = (await patched.json()) as { body: string }
  expect(updated.body === "updated", "PATCH updates the row")

  const removed = await DELETE(request("DELETE", url), ctx)
  expect(removed.status === 204, "DELETE answers 204")

  const gone = await GET(request("GET", url), ctx)
  expect(gone.status === 404, "GET member answers 404 after DELETE")

  return true
}
`

describe("phase 3 resource", () => {
  beforeAll(async () => {
    enterApp()
    await ok(dbInit, [
      "--adapter=drizzle",
      "--provider=sqlite",
      "--skip-install",
    ])
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>
    }
    pkg.dependencies["drizzle-orm"] = "0.45.2"
    writeFileSync(
      join(app, "package.json"),
      `${JSON.stringify(pkg, null, 2)}\n`
    )
    baseline = tree()
  }, 30_000)
  afterAll(leaveApp)

  it("g resource needs at least one attribute", async () => {
    const { exit, err } = await run(resource, ["Post"])
    expect(exit).toBe(1)
    expect(err).toContain("attributes-required")
  })

  it("g resource writes the whole flow under one manifest", async () => {
    const { out } = await ok(resource, [
      "Post",
      "title:string",
      "body:text",
      "published:boolean",
      "--skip-install",
    ])
    const rows = JSON.parse(out) as { action: string; path: string }[]
    const notes = rows
      .filter((row) => row.action === "note")
      .map((row) => row.path)
    expect(notes).toHaveLength(2)
    expect(notes[0]).toContain("@playwright/test")
    expect(notes[1]).toContain("<Nav />")
    for (const file of [
      "src/db/schema/posts.ts",
      "src/lib/validators/post.ts",
      "src/services/posts.ts",
      "src/app/posts/actions.ts",
      "src/components/posts/post-form.tsx",
      "src/app/posts/page.tsx",
      "src/app/posts/loading.tsx",
      "src/app/posts/error.tsx",
      "src/app/posts/new/page.tsx",
      "src/app/posts/[id]/page.tsx",
      "src/app/posts/[id]/edit/page.tsx",
      "src/lib/display.ts",
      "src/lib/display.test.ts",
      "src/components/nav.tsx",
      "e2e/posts.spec.ts",
      ".app/manifests/resource-post.json",
    ]) {
      expect(has(file), file).toBe(true)
    }
    expect(has(".app/manifests/model-post.json")).toBe(false)
    expect(read("src/app/posts/actions.ts")).toContain(
      "export const removePost"
    )
    expect(read("src/components/nav.tsx")).toContain(
      '{ href: "/posts", label: "Posts" },'
    )
    expect(read("src/app/posts/page.tsx")).toContain("postQuerySchema")
    expect(read("src/app/posts/[id]/page.tsx")).toContain("notFound()")
    expect(read("e2e/posts.spec.ts")).toContain(
      'getByLabel("Title").fill(title)'
    )
    expect(read("src/lib/actions.ts")).toBeTruthy()
  })

  it("g resource refuses a second run and g form reuses the resource manifest", async () => {
    const second = await run(resource, ["Post", "title:string"])
    expect(second.exit).toBe(1)
    expect(second.err).toContain("file-exists")
    const again = await run(form, ["Post"])
    expect(again.exit).toBe(1)
    expect(again.err).toContain("file-exists")
    expect(again.err).not.toContain("attributes-required")
  })

  it("g resource --api writes REST handlers instead of the UI", async () => {
    const { out } = await ok(resource, [
      "Comment",
      "body:text",
      "--api",
      "--skip-install",
    ])
    const rows = JSON.parse(out) as { action: string; path: string }[]
    expect(rows.filter((row) => row.action === "note")).toHaveLength(0)
    for (const file of [
      "src/db/schema/comments.ts",
      "src/lib/validators/comment.ts",
      "src/services/comments.ts",
      "src/app/api/comments/route.ts",
      "src/app/api/comments/[id]/route.ts",
      ".app/manifests/resource-comment.json",
    ]) {
      expect(has(file), file).toBe(true)
    }
    expect(has(".app/manifests/model-comment.json")).toBe(false)
    for (const file of [
      "src/app/comments/page.tsx",
      "src/components/comments/comment-form.tsx",
      "e2e/comments.spec.ts",
    ]) {
      expect(has(file), file).toBe(false)
    }
    expect(read("src/components/nav.tsx")).not.toContain("/comments")
    const collection = read("src/app/api/comments/route.ts")
    expect(collection).toContain("export { GET, POST }")
    expect(collection).toContain("insertCommentSchema")
    expect(collection).toContain("listComments(query)")
    const member = read("src/app/api/comments/[id]/route.ts")
    expect(member).toContain("export { DELETE, GET, PATCH }")
    expect(member).toContain("updateCommentSchema")
  })

  it("routes lists the four pages with their segment kinds", async () => {
    const { out } = await ok(routes, ["--grep=posts"])
    const rows = JSON.parse(out) as {
      path: string
      kinds: string
      file: string
    }[]
    expect(rows.map((row) => `${row.path} ${row.file} ${row.kinds}`)).toEqual([
      "/posts page static",
      "/posts/[id] page static, dynamic",
      "/posts/[id]/edit page static, dynamic",
      "/posts/new page static",
    ])
    expect(Object.keys(rows[0] ?? {})).not.toContain("rendering")
    const bad = await run(routes, ["--grep=("])
    expect(bad.exit).toBe(1)
    expect(bad.err).toContain("invalid-grep")
  })

  it("everything generated typechecks", async () => {
    const { output, exitCode } = await exec([
      join(app, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "-p",
      ".",
    ])
    expect(output).toBe("")
    expect(exitCode).toBe(0)
  }, 60_000)

  it("the generated unit tests pass", async () => {
    const { output, exitCode } = await exec([
      join(app, "node_modules/vitest/vitest.mjs"),
      "run",
      "--no-color",
      "src/components",
      "src/lib",
    ])
    expect(output).toContain("Test Files  4 passed")
    expect(exitCode).toBe(0)
  }, 60_000)

  it("runner evaluates against the migrated database and reflects the result", async () => {
    await ok(dbMigrate, [])
    const empty = await cli(["runner", "services.posts.listPosts()"])
    expect(empty.output).toContain("total: 0")
    expect(empty.exitCode).toBe(0)

    const inserted = await cli([
      "runner",
      "--sandbox",
      'services.posts.createPost({ title: "Draft", body: "x", published: false })',
    ])
    expect(inserted.output).toContain("title: 'Draft'")
    expect(inserted.exitCode).toBe(0)
    const after = await cli(["runner", "services.posts.listPosts()"])
    expect(after.output).toContain("total: 0")

    const falsy = await cli([
      "runner",
      "(await services.posts.listPosts()).total > 0",
    ])
    expect(falsy.output).toContain("false")
    expect(falsy.exitCode).toBe(1)

    writeFileSync(
      join(app, "check.ts"),
      "export default async ({ services }) => (await services.posts.listPosts()).total === 0\n"
    )
    const file = await cli(["runner", "check.ts"])
    expect(file.exitCode).toBe(0)
    rmSync(join(app, "check.ts"))
  }, 60_000)

  it("the API handlers answer against the migrated database", async () => {
    await ok(dbMigrate, [])
    writeFileSync(join(app, "api-check.ts"), API_CHECK)
    const check = await cli(["runner", "api-check.ts"])
    expect(check.output).toBe("")
    expect(check.exitCode).toBe(0)
    rmSync(join(app, "api-check.ts"))
    await ok(destroy, ["resource", "Comment"])
    expect(has("src/app/api/comments/route.ts")).toBe(false)
    expect(has("src/app/api/comments/[id]/route.ts")).toBe(false)
    expect(has("src/services/comments.ts")).toBe(false)
  }, 60_000)

  it("destroy resource returns the tree to the baseline", async () => {
    await ok(destroy, ["resource", "Post"])
    expect(has("src/components/nav.tsx")).toBe(false)
    expect(has("src/lib/actions.ts")).toBe(false)
    expect(tree()).toEqual(baseline)
  })
})
