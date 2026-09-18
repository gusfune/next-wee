/**
 * Phase 4 acceptance for the generators on top of the resource app:
 * `g auth --provider=better-auth` signs a user up and in through the
 * runner, `g auth:provider` adds a social provider, `g job` registers a
 * job function, `g email` renders, everything typechecks and the
 * generated unit tests pass. `destroy` reverses each run.
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
import { auth } from "../src/commands/g/auth.js"
import { authProvider } from "../src/commands/g/auth-provider.js"
import { email } from "../src/commands/g/email.js"
import { job } from "../src/commands/g/job.js"
import { resource } from "../src/commands/g/resource.js"
import { mailPreview } from "../src/commands/mail.js"

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
  include: ["src"],
}

const enterApp = (): void => {
  app = mkdtempSync(join(tmpdir(), "wee-auth-"))
  cpSync(join(fixtures, "single-repo"), app, { recursive: true })
  symlinkSync(join(root, "node_modules"), join(app, "node_modules"))
  writeFileSync(
    join(app, ".env"),
    "DATABASE_URL=./local.sqlite\nBETTER_AUTH_SECRET=test-secret-test-secret-test-secret\nBETTER_AUTH_URL=http://localhost:3000\n"
  )
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

const cli = (args: string[]): Promise<Exec> =>
  exec(["--import", "tsx", join(root, "src/cli.ts"), ...args])

const config = (): {
  auth?: { provider: string }
} => JSON.parse(read(".app/config.json"))

describe("phase 4 auth, jobs and mail", () => {
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
    await ok(resource, ["Post", "title:string", "--skip-install"])
    baseline = tree()
  }, 60_000)
  afterAll(leaveApp)

  it("g auth rejects an unknown provider", async () => {
    const { exit, err } = await run(auth, ["--provider=clerk"])
    expect(exit).toBe(1)
    expect(err).toContain("invalid-auth-provider")
  })

  it("g auth --provider=placeholder writes the stub and the config", async () => {
    await ok(auth, ["--provider=placeholder"])
    expect(read("src/lib/auth/index.ts")).toContain("PLACEHOLDER_USER")
    expect(config().auth).toEqual({ provider: "placeholder" })
    const signedIn = await cli([
      "runner",
      "(await auth.api.getSession()).user.id",
    ])
    expect(signedIn.output).toContain("placeholder")
    expect(signedIn.exitCode).toBe(0)
    await ok(destroy, ["auth", "placeholder"])
    expect(tree()).toEqual(baseline)
  }, 60_000)

  it("g auth --provider=better-auth writes the tables, the module and the sign-in page", async () => {
    const { out } = await ok(auth, ["--provider=better-auth", "--skip-install"])
    const rows = JSON.parse(out) as { action: string; path: string }[]
    expect(rows.at(-1)).toEqual({
      action: "note",
      path: "add better-auth to package.json",
    })
    for (const file of [
      "src/db/schema/users.ts",
      "src/db/schema/sessions.ts",
      "src/db/schema/accounts.ts",
      "src/db/schema/verifications.ts",
      "src/lib/auth/index.ts",
      "src/lib/auth/providers.ts",
      "src/lib/auth/client.ts",
      "src/app/api/auth/[...all]/route.ts",
      "src/app/sign-in/page.tsx",
      "src/components/auth/sign-in-form.tsx",
      "src/components/auth/sign-in-form.test.tsx",
      ".app/manifests/auth-better-auth.json",
    ]) {
      expect(has(file), file).toBe(true)
    }
    expect(has("src/lib/validators/user.ts")).toBe(false)
    expect(read("src/db/schema/sessions.ts")).toContain(
      "references(() => users.id"
    )
    const migrations = readdirSync(join(app, "src/db/migrations")).filter(
      (name) => name.endsWith(".sql")
    )
    expect(
      migrations.some((name) => name.endsWith("_create_auth_tables.sql"))
    ).toBe(true)
    const down = migrations.find((name) =>
      name.endsWith("_create_auth_tables.down.sql")
    )
    expect(down).toBeDefined()
    expect(read(`src/db/migrations/${down}`)).toMatch(
      /DROP TABLE "verifications";[\s\S]*DROP TABLE "users";/
    )
    expect(read("src/lib/auth/index.ts")).toContain('provider: "sqlite"')
    expect(read(".env.example")).toContain("BETTER_AUTH_SECRET=")
    expect(config().auth).toEqual({ provider: "better-auth" })
    const second = await run(auth, ["--provider=better-auth", "--skip-install"])
    expect(second.exit).toBe(1)
    expect(second.err).toContain("file-exists")
  }, 60_000)

  it("g auth:provider adds a social provider block and its keys", async () => {
    const missing = await run(authProvider, ["GitHub"])
    expect(missing.exit).toBe(0)
    const providers = read("src/lib/auth/providers.ts")
    expect(providers).toContain("// wee:begin provider-github")
    expect(providers).toContain("process.env.GITHUB_CLIENT_ID")
    expect(read(".env.example")).toContain("GITHUB_CLIENT_SECRET=")
    const again = await run(authProvider, ["github"])
    expect(again.exit).toBe(1)
    expect(again.err).toContain("block-exists")
  })

  it("g job writes the function and registers it", async () => {
    await ok(job, ["SendWelcome", "--skip-install"])
    await ok(job, ["Nightly", "--skip-install"])
    for (const file of [
      "src/jobs/index.ts",
      "src/jobs/send-welcome.ts",
      "src/jobs/send-welcome.test.ts",
      "src/jobs/nightly.ts",
      "src/jobs/nightly.test.ts",
    ]) {
      expect(has(file), file).toBe(true)
    }
    expect(has("src/lib/inngest.ts")).toBe(false)
    expect(has("src/app/api/inngest/route.ts")).toBe(false)
    const index = read("src/jobs/index.ts")
    expect(index).toContain('import { sendWelcome } from "./send-welcome"')
    expect(index).toContain("  sendWelcome,")
    expect(index).toContain("  nightly,")
    expect(index).toContain("const jobs = [")
    expect(read("src/jobs/send-welcome.ts")).toContain(
      "const sendWelcome = async ("
    )
    expect(read(".env.example")).not.toContain("INNGEST")
    await ok(destroy, ["job", "Nightly"])
    expect(has("src/jobs/nightly.ts")).toBe(false)
    expect(read("src/jobs/index.ts")).not.toContain("nightly")
    expect(has("src/jobs/index.ts")).toBe(true)
  })

  it("g email writes the component, the test and the sender", async () => {
    await ok(email, ["Welcome", "--skip-install"])
    expect(has("src/lib/mail.ts")).toBe(true)
    expect(read("src/emails/welcome.tsx")).toContain(
      "export default WelcomeEmail"
    )
    expect(has("src/emails/welcome.test.tsx")).toBe(true)
    expect(read(".env.example")).toContain("RESEND_API_KEY=")
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
  }, 90_000)

  it("the generated unit tests pass", async () => {
    const { output, exitCode } = await exec([
      join(app, "node_modules/vitest/vitest.mjs"),
      "run",
      "--no-color",
      "src/components/auth",
      "src/jobs",
      "src/emails",
    ])
    expect(output).toContain("Test Files  3 passed")
    expect(exitCode).toBe(0)
  }, 60_000)

  it("Better Auth signs a user up and in against the migrated database", async () => {
    await ok(dbMigrate, [])
    const signUp = await cli([
      "runner",
      '(await auth.api.signUpEmail({ body: { name: "Ada", email: "ada@example.com", password: "correct horse battery" } })).user.email',
    ])
    expect(signUp.output).toContain("ada@example.com")
    expect(signUp.exitCode).toBe(0)
    const signIn = await cli([
      "runner",
      'typeof (await auth.api.signInEmail({ body: { email: "ada@example.com", password: "correct horse battery" } })).token',
    ])
    expect(signIn.output).toContain("string")
    expect(signIn.exitCode).toBe(0)
    const wrong = await cli([
      "runner",
      'auth.api.signInEmail({ body: { email: "ada@example.com", password: "wrong password" } })',
    ])
    expect(wrong.exitCode).toBe(1)
  }, 90_000)

  it("mail:preview needs the emails folder", async () => {
    await ok(destroy, ["email", "WelcomeEmail"])
    expect(has("src/emails")).toBe(false)
    const { exit, err } = await run(mailPreview, [])
    expect(exit).toBe(1)
    expect(err).toContain("emails-missing")
  })

  it("destroy returns the tree to the baseline", async () => {
    await ok(destroy, ["job", "SendWelcome"])
    await ok(destroy, ["auth-provider", "github"])
    await ok(destroy, ["auth", "better-auth"])
    expect(tree()).toEqual(baseline)
  })
})
