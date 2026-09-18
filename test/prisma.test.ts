/**
 * Phase 4 acceptance for the Prisma adapter on sqlite: `db:init
 * --adapter=prisma`, `g model`, `db:migrate` gives a queryable table and a
 * generated client; the validator test passes; `g migration` edits the
 * model; `db:rollback` fails with the manual procedure; `destroy` and
 * `db:reset` reverse cleanly; the runner evaluates against the database.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ArgsDef, CommandDef } from "citty"
import { runCommand } from "citty"
import { x } from "tinyexec"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  dbInit,
  dbMigrate,
  dbPrepare,
  dbReset,
  dbRollback,
  dbStatus,
} from "../src/commands/db.js"
import { destroy } from "../src/commands/destroy.js"
import { auth } from "../src/commands/g/auth.js"
import { migration } from "../src/commands/g/migration.js"
import { model } from "../src/commands/g/model.js"

const root = join(import.meta.dirname, "..")
const fixtures = join(root, "fixtures")

let app: string
let originalCwd: string
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

const MIGRATIONS = "src/db/migrations"

/** Migration folder names in order. */
const migrations = (): string[] =>
  readdirSync(join(app, MIGRATIONS), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

const migrationNamed = (suffix: string): string => {
  const found = migrations().find((name) => name.endsWith(`_${suffix}`))
  if (found === undefined) {
    throw new Error(`no migration ending in _${suffix}`)
  }
  return found
}

const tables = async (): Promise<string[]> => {
  const { default: Database } = await import("better-sqlite3")
  const db = new Database(join(app, "local.sqlite"))
  try {
    return db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all()
      .map((row) => row.name)
  } finally {
    db.close()
  }
}

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
  app = mkdtempSync(join(tmpdir(), "wee-prisma-"))
  cpSync(join(fixtures, "single-repo"), app, { recursive: true })
  symlinkSync(join(root, "node_modules"), join(app, "node_modules"))
  writeFileSync(
    join(app, ".env"),
    "DATABASE_URL=file:./local.sqlite\nBETTER_AUTH_SECRET=test-secret-test-secret-test-secret\n"
  )
  writeFileSync(
    join(app, "tsconfig.json"),
    `${JSON.stringify(TSCONFIG, null, 2)}\n`
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

describe("phase 4 prisma on sqlite", () => {
  beforeAll(enterApp)
  afterAll(leaveApp)

  it("db:init --adapter=prisma writes the prisma scaffold and config", async () => {
    await ok(dbInit, [
      "--adapter=prisma",
      "--provider=sqlite",
      "--skip-install",
    ])
    const config = JSON.parse(read(".app/config.json")) as {
      db: Record<string, string>
    }
    expect(config.db).toEqual({
      adapter: "prisma",
      provider: "sqlite",
      schemaDir: "db/schema",
      migrationsDir: "db/migrations",
    })
    expect(read("prisma.config.ts")).toContain('schema: "src/db/schema"')
    expect(read("src/db/schema/schema.prisma")).toContain(
      'provider = "prisma-client"'
    )
    expect(read("src/db/schema/schema.prisma")).toContain(
      'output   = "../generated"'
    )
    expect(read("src/db/client.ts")).toContain("PrismaBetterSqlite3")
    expect(has("src/db/seed.ts")).toBe(true)
    expect(read(".gitignore")).toContain("src/db/generated/")
    expect(read(".env.example")).toContain("DATABASE_URL=file:./local.sqlite")
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>
      scripts: Record<string, string>
    }
    expect(pkg.scripts["db:migrate"]).toBe("wee db:migrate")
    pkg.dependencies["@prisma/client"] = "7.10.0"
    writeFileSync(
      join(app, "package.json"),
      `${JSON.stringify(pkg, null, 2)}\n`
    )
  })

  it("rejects an unknown adapter and a second init", async () => {
    const unknown = await run(dbInit, ["--adapter=typeorm", "--force"])
    expect(unknown.exit).toBe(1)
    expect(unknown.err).toContain("invalid-adapter")
    const again = await run(dbInit, ["--adapter=prisma"])
    expect(again.exit).toBe(1)
    expect(again.err).toContain("db-already-initialised")
  })

  it("g model writes the prisma model, validator, service and migration", async () => {
    await ok(model, [
      "Post",
      "title:string",
      "body:text:optional",
      "views:integer:default=0",
      "status:enum[draft,published]",
    ])
    const source = read("src/db/schema/posts.prisma")
    expect(source).toContain("enum PostStatus {")
    expect(source).toContain("model Post {")
    expect(source).toContain("title     String")
    expect(source).toContain("body      String?")
    expect(source).toContain("views     Int        @default(0)")
    expect(source).toContain("status    PostStatus")
    expect(source).toContain(
      'createdAt DateTime   @default(now()) @map("created_at")'
    )
    expect(source).toContain('@@map("posts")')
    expect(has("src/lib/validators/post.ts")).toBe(true)
    expect(has("src/lib/validators/post.test.ts")).toBe(true)
    expect(read("src/services/posts.ts")).toContain("db.post.findMany(")
    const folder = migrationNamed("create_posts")
    expect(folder).toMatch(/^\d{14}_create_posts$/)
    expect(read(`${MIGRATIONS}/${folder}/migration.sql`)).toContain(
      'CREATE TABLE "posts"'
    )
    expect(read(`${MIGRATIONS}/${folder}/down.sql`)).toContain(
      'DROP TABLE "posts"'
    )
    expect(read(`${MIGRATIONS}/migration_lock.toml`)).toContain(
      'provider = "sqlite"'
    )
  }, 60_000)

  it("the generated validator test passes", async () => {
    const { output, exitCode } = await exec([
      join(app, "node_modules/vitest/vitest.mjs"),
      "run",
      "--no-color",
      "src/lib/validators",
    ])
    expect(output).toContain("2 passed")
    expect(exitCode).toBe(0)
  }, 30_000)

  it("db:migrate creates a queryable table, generates the client and db:status reports it applied", async () => {
    await ok(dbMigrate, [])
    expect(await tables()).toEqual(["_prisma_migrations", "posts"])
    expect(has("src/db/generated/client.ts")).toBe(true)
    const { out } = await ok(dbStatus, [])
    expect(JSON.parse(out)).toEqual([
      expect.objectContaining({
        action: "applied",
        path: migrationNamed("create_posts"),
      }),
    ])
  }, 60_000)

  it("g migration AddXToY edits the model and writes up and down SQL", async () => {
    await ok(migration, ["AddSlugToPosts", "slug:string:unique"])
    expect(read("src/db/schema/posts.prisma")).toContain(
      "slug      String     @unique"
    )
    const folder = migrationNamed("add_slug_to_posts")
    expect(read(`${MIGRATIONS}/${folder}/migration.sql`)).toContain('"slug"')
    // SQLite drops a column by rebuilding the table.
    expect(read(`${MIGRATIONS}/${folder}/down.sql`)).toContain(
      'RENAME TO "posts"'
    )
  })

  it("g model with references injects the back relation and migrates", async () => {
    await ok(model, ["Comment", "body:text", "post:references"])
    const comments = read("src/db/schema/comments.prisma")
    expect(comments).toContain('postId    String   @map("post_id")')
    expect(comments).toContain(
      "post      Post     @relation(fields: [postId], references: [id], onDelete: Restrict)"
    )
    expect(comments).toContain("@@index([postId])")
    expect(read("src/db/schema/posts.prisma")).toContain("comments Comment[]")
    await ok(dbMigrate, [])
    expect(await tables()).toEqual(["_prisma_migrations", "comments", "posts"])
  }, 60_000)

  it("g auth --provider=better-auth writes the four models in one migration and signs in", async () => {
    await ok(auth, ["--provider=better-auth", "--skip-install"])
    const users = read("src/db/schema/users.prisma")
    expect(users).toContain("sessions Session[]")
    expect(users).toContain("accounts Account[]")
    expect(read("src/lib/auth/index.ts")).toContain(
      'prismaAdapter(db, { provider: "sqlite" })'
    )
    expect(migrationNamed("create_auth_tables")).toMatch(
      /^\d{14}_create_auth_tables$/
    )
    await ok(dbMigrate, [])
    expect(await tables()).toEqual([
      "_prisma_migrations",
      "accounts",
      "comments",
      "posts",
      "sessions",
      "users",
      "verifications",
    ])
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
  }, 120_000)

  it("everything generated typechecks against the generated client", async () => {
    const { output, exitCode } = await exec([
      join(app, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "-p",
      ".",
    ])
    expect(output).toBe("")
    expect(exitCode).toBe(0)
  }, 90_000)

  it("runner evaluates against the database and the sandbox rolls back", async () => {
    const empty = await cli(["runner", "services.posts.listPosts()"])
    expect(empty.output).toContain("total: 0")
    expect(empty.exitCode).toBe(0)
    const inserted = await cli([
      "runner",
      "--sandbox",
      'db.post.create({ data: { title: "Draft", status: "draft", slug: "draft" } })',
    ])
    expect(inserted.output).toContain("title: 'Draft'")
    expect(inserted.exitCode).toBe(0)
    const after = await cli(["runner", "db.post.count()"])
    expect(after.output).toContain("0")
    expect(after.exitCode).toBe(0)
  }, 60_000)

  it("db:rollback fails with the manual procedure", async () => {
    const { err, exit } = await run(dbRollback, ["--step=1"])
    expect(exit).toBe(1)
    expect(err).toContain("rollback-manual")
    expect(err).toContain(`${migrationNamed("create_auth_tables")}/down.sql`)
    expect(err).toContain("DELETE FROM _prisma_migrations")
  })

  it("destroy model and destroy migration restore the schema files", async () => {
    await ok(destroy, ["auth", "better-auth"])
    expect(has("src/db/schema/users.prisma")).toBe(false)
    expect(has("src/lib/auth/index.ts")).toBe(false)
    await ok(destroy, ["model", "Comment"])
    expect(has("src/db/schema/comments.prisma")).toBe(false)
    expect(read("src/db/schema/posts.prisma")).not.toContain("Comment[]")
    await ok(destroy, ["migration", "add_slug_to_posts"])
    expect(read("src/db/schema/posts.prisma")).not.toContain("slug")
    expect(migrations()).toEqual([migrationNamed("create_posts")])
  })

  it("db:reset rebuilds the database from the remaining migrations, db:prepare is idempotent", async () => {
    await ok(dbReset, [])
    expect(await tables()).toEqual(["_prisma_migrations", "posts"])
    const { out } = await ok(dbPrepare, [])
    expect(
      (JSON.parse(out) as Array<{ action: string }>).map((row) => row.action)
    ).toEqual(["exists", "migrated", "not-seeded"])
  }, 60_000)
})

describe("db:init --adapter=prisma refuses an existing Prisma setup", () => {
  beforeAll(() => {
    enterApp()
    mkdirSync(join(app, "prisma"))
    writeFileSync(join(app, "prisma/schema.prisma"), "")
  })
  afterAll(leaveApp)

  it("fails with adopt-unsupported", async () => {
    const { exit, err } = await run(dbInit, [
      "--adapter=prisma",
      "--skip-install",
    ])
    expect(exit).toBe(1)
    expect(err).toContain("adopt-unsupported")
    expect(err).toContain("prisma/schema.prisma")
  })
})
