/**
 * Phase 2 acceptance: every route and UI generator emits into a scratch
 * app, the result typechecks under a Next-style tsconfig, the generated
 * tests pass, and `destroy` returns the tree to its baseline. Shared files
 * (`env.ts`, `proxy.ts`, `actions.ts`, `lib/actions.ts`) survive until the
 * last run that refers to them is destroyed.
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
import { dbInit } from "../src/commands/db.js"
import { destroy } from "../src/commands/destroy.js"
import { action } from "../src/commands/g/action.js"
import { component } from "../src/commands/g/component.js"
import { env } from "../src/commands/g/env.js"
import { form } from "../src/commands/g/form.js"
import { handler } from "../src/commands/g/handler.js"
import { helper } from "../src/commands/g/helper.js"
import { hook } from "../src/commands/g/hook.js"
import { layout } from "../src/commands/g/layout.js"
import { metadata } from "../src/commands/g/metadata.js"
import { model } from "../src/commands/g/model.js"
import { page } from "../src/commands/g/page.js"
import { provider } from "../src/commands/g/provider.js"
import { proxy } from "../src/commands/g/proxy.js"
import { type } from "../src/commands/g/type.js"

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

/** Runs a command and fails loudly with its stderr when it does not exit 0. */
const ok = async <T extends ArgsDef>(
  command: CommandDef<T>,
  rawArgs: string[]
): Promise<void> => {
  const { exit, err } = await run(command, rawArgs)
  expect(err).toBe("")
  expect(exit).toBe(0)
}

const read = (path: string): string => readFileSync(join(app, path), "utf8")
const has = (path: string): boolean => existsSync(join(app, path))

/** Sorted relative paths of every file in the app, node_modules excluded. */
const tree = (dir = app): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.name === "node_modules") {
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
  include: ["src"],
}

const enterApp = (): void => {
  app = mkdtempSync(join(tmpdir(), "wee-ui-"))
  cpSync(join(fixtures, "single-repo"), app, { recursive: true })
  symlinkSync(join(root, "node_modules"), join(app, "node_modules"))
  writeFileSync(join(app, ".env"), "DATABASE_URL=./local.sqlite\n")
  writeFileSync(
    join(app, "tsconfig.json"),
    `${JSON.stringify(TSCONFIG, null, 2)}\n`
  )
  // db:init --skip-install leaves better-sqlite3 untyped; wee's own shim covers it.
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

const exec = async (
  args: string[]
): Promise<{ output: string; exitCode: number | undefined }> => {
  const result = await x("node", args, {
    nodeOptions: { cwd: app },
    throwOnError: false,
  })
  return {
    output: `${result.stdout}${result.stderr}`,
    exitCode: result.exitCode,
  }
}

describe("phase 2 routes and ui", () => {
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
    await ok(model, ["Post", "title:string", "body:text", "published:boolean"])
    baseline = tree()
  }, 30_000)
  afterAll(leaveApp)

  it("g page writes page, loading, error and optional layout", async () => {
    await ok(page, ["posts/[id]/comments", "--layout"])
    await ok(page, ["posts", "--skip-loading", "--skip-error"])
    const file = read("src/app/posts/[id]/comments/page.tsx")
    expect(file).toContain("params: Promise<{ id: string }>")
    expect(file).toContain("export default Page")
    expect(has("src/app/posts/[id]/comments/loading.tsx")).toBe(true)
    expect(read("src/app/posts/[id]/comments/error.tsx")).toContain(
      '"use client"'
    )
    expect(has("src/app/posts/[id]/comments/layout.tsx")).toBe(true)
    expect(has("src/app/posts/loading.tsx")).toBe(false)
    expect(has("src/app/posts/error.tsx")).toBe(false)
  })

  it("g page refuses to overwrite without --force", async () => {
    const { exit, err } = await run(page, ["posts"])
    expect(exit).toBe(1)
    expect(err).toContain("file-exists")
  })

  it("g layout writes a route group layout", async () => {
    await ok(layout, ["(marketing)"])
    expect(read("src/app/(marketing)/layout.tsx")).toContain("children")
  })

  it("g handler writes route.ts with the given methods and a test", async () => {
    await ok(handler, ["api/posts", "--methods=GET,POST"])
    const file = read("src/app/api/posts/route.ts")
    expect(file).toContain("export { GET, POST }")
    expect(file).toContain("bodySchema")
    const test = read("src/app/api/posts/route.test.ts")
    expect(test).toContain('import { GET, POST } from "./route"')
    expect(test).toContain("expect(response.status).toBe(400)")
    expect(test).toContain("expect(response.status).toBe(201)")
    const { exit, err } = await run(handler, ["api/x", "--methods=FETCH"])
    expect(exit).toBe(1)
    expect(err).toContain("invalid-method")
  })

  it("g metadata writes sitemap and og image", async () => {
    await ok(metadata, ["posts"])
    expect(read("src/app/sitemap.ts")).toContain("MetadataRoute.Sitemap")
    expect(read("src/app/posts/opengraph-image.tsx")).toContain("ImageResponse")
  })

  it("g component writes a client component in its area with a test", async () => {
    await ok(component, ["PostCard", "--area=posts", "--client"])
    const file = read("src/components/posts/post-card.tsx")
    expect(file.startsWith('"use client"')).toBe(true)
    expect(file).toContain("export { PostCard }")
    expect(has("src/components/posts/post-card.test.tsx")).toBe(true)
  })

  it("g form needs the actions first", async () => {
    const { exit, err } = await run(form, ["Post"])
    expect(exit).toBe(1)
    expect(err).toContain("actions-missing")
  })

  it("g action writes model-bound and generic actions into one file", async () => {
    await ok(action, ["posts", "create", "update", "remove", "publish"])
    const file = read("src/app/posts/actions.ts")
    expect(file.startsWith('"use server"')).toBe(true)
    for (const fn of [
      "createPost",
      "updatePost",
      "removePost",
      "publishPost",
    ]) {
      expect(file).toContain(`export const ${fn} = async (`)
    }
    expect(file).toContain('from "../../lib/validators/post"')
    expect(file).toContain('from "../../services/posts"')
    expect(has("src/lib/actions.ts")).toBe(true)
    const { exit, err } = await run(action, ["posts", "publish"])
    expect(exit).toBe(1)
    expect(err).toContain("block-exists")
  })

  it("g form binds the form to the actions", async () => {
    await ok(form, ["Post"])
    const file = read("src/components/posts/post-form.tsx")
    expect(file).toContain("useActionState")
    expect(file).toContain('name="title"')
    expect(file).toContain('from "../../app/posts/actions"')
    expect(has("src/components/posts/post-form.test.tsx")).toBe(true)
  })

  it("g hook, helper, provider and type write their files", async () => {
    await ok(hook, ["useComments"])
    await ok(helper, ["formatMoney"])
    await ok(provider, ["Theme"])
    await ok(type, ["PaymentStatus", "paid", "pending", "failed"])
    await ok(type, ["Money", "amount:integer", "currency:string"])
    expect(read("src/hooks/use-comments.ts")).toContain(
      "export { useComments }"
    )
    expect(read("src/lib/format-money.ts")).toContain("export { formatMoney }")
    expect(read("src/components/providers/theme-provider.tsx")).toContain(
      "useTheme"
    )
    expect(read("src/types/payment-status.ts")).toContain(
      '"paid" | "pending" | "failed"'
    )
    expect(read("src/types/money.ts")).toContain("amount: number")
  })

  it("g env adds server and client variables to env.ts and .env.example", async () => {
    await ok(env, ["STRIPE_KEY:server", "NEXT_PUBLIC_POSTHOG_KEY:client"])
    await ok(env, ["SENTRY_DSN"])
    const file = read("src/env.ts")
    expect(file).toContain("STRIPE_KEY: z.string(),")
    expect(file).toContain(
      "NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,"
    )
    expect(file).toContain("SENTRY_DSN: z.string(),")
    expect(read(".env.example")).toContain("STRIPE_KEY=")
    const { exit, err } = await run(env, ["POSTHOG_KEY:client"])
    expect(exit).toBe(1)
    expect(err).toContain("invalid-env-scope")
  })

  it("g proxy adds interceptors and matchers to proxy.ts", async () => {
    await ok(proxy, ["auth", "--matcher=/dashboard/:path*"])
    await ok(proxy, ["admin"])
    const file = read("src/proxy.ts")
    expect(file).toContain('"/dashboard/:path*",')
    expect(file).toContain('"/admin/:path*",')
    expect(file).toContain("wee:begin proxy-auth")
    expect(file).toContain("wee:begin proxy-admin-matcher")
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

  it("the generated tests pass", async () => {
    const { output, exitCode } = await exec([
      join(app, "node_modules/vitest/vitest.mjs"),
      "run",
      "--no-color",
      "src/app",
      "src/components",
      "src/hooks",
      "src/lib",
    ])
    expect(output).toContain("Test Files  7 passed")
    expect(exitCode).toBe(0)
  }, 60_000)

  it("destroy keeps shared files until the last run goes", async () => {
    await ok(destroy, ["env", "sentry-dsn"])
    expect(has("src/env.ts")).toBe(true)
    expect(read("src/env.ts")).not.toContain("SENTRY_DSN")
    await ok(destroy, ["env", "stripe-key-next-public-posthog-key"])
    expect(has("src/env.ts")).toBe(false)
    expect(read(".env.example")).not.toContain("STRIPE_KEY")

    await ok(destroy, ["form", "Post"])
    expect(has("src/lib/actions.ts")).toBe(true)
    await ok(destroy, ["action", "posts-create-update-remove-publish"])
    expect(has("src/lib/actions.ts")).toBe(false)
    expect(has("src/app/posts/actions.ts")).toBe(false)

    await ok(destroy, ["proxy", "admin"])
    expect(read("src/proxy.ts")).not.toContain("admin")
    await ok(destroy, ["proxy", "auth"])
    expect(has("src/proxy.ts")).toBe(false)
  })

  it("destroy returns the tree to the baseline", async () => {
    await ok(destroy, ["type", "Money"])
    await ok(destroy, ["type", "PaymentStatus"])
    await ok(destroy, ["provider", "Theme"])
    await ok(destroy, ["helper", "formatMoney"])
    await ok(destroy, ["hook", "useComments"])
    await ok(destroy, ["component", "PostCard"])
    await ok(destroy, ["metadata", "posts"])
    await ok(destroy, ["handler", "api/posts"])
    await ok(destroy, ["layout", "(marketing)"])
    await ok(destroy, ["page", "posts"])
    await ok(destroy, ["page", "posts/[id]/comments"])
    expect(tree()).toEqual(baseline)
  })
})

describe("g helper --shared in a turborepo", () => {
  let repo: string
  let cwd: string

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "wee-shared-"))
    cpSync(join(fixtures, "turborepo"), repo, { recursive: true })
    cwd = process.cwd()
    process.chdir(repo)
  })
  afterAll(() => {
    process.chdir(cwd)
    rmSync(repo, { recursive: true, force: true })
  })

  it("writes into the only shared package and re-exports from its index", async () => {
    const { exit, err } = await run(helper, [
      "formatMoney",
      "--shared",
      "--app=web",
    ])
    expect(err).toBe("")
    expect(exit).toBe(0)
    const index = readFileSync(join(repo, "packages/ui/src/index.ts"), "utf8")
    expect(index).toContain('export * from "./format-money"')
    expect(existsSync(join(repo, "packages/ui/src/format-money.ts"))).toBe(true)
    expect(
      existsSync(
        join(repo, "packages/ui/.app/manifests/helper-format-money.json")
      )
    ).toBe(true)
  })

  it("destroy needs --package and restores the index", async () => {
    const { exit, err } = await run(destroy, [
      "helper",
      "formatMoney",
      "--package=ui",
    ])
    expect(err).toBe("")
    expect(exit).toBe(0)
    const index = readFileSync(join(repo, "packages/ui/src/index.ts"), "utf8")
    expect(index).not.toContain("format-money")
    expect(existsSync(join(repo, "packages/ui/src/format-money.ts"))).toBe(
      false
    )
  })
})
