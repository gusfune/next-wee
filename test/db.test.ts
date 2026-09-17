/**
 * Phase 1 acceptance on sqlite: `db:init`, `g model`, `db:migrate` gives a
 * queryable table; the generated validator test passes; `db:rollback`,
 * `g migration` and `destroy` reverse cleanly. Postgres and MySQL share
 * the same code paths except the raw driver, which this suite does not run.
 */
import {
  cpSync,
  existsSync,
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
import { migration } from "../src/commands/g/migration.js"
import { model } from "../src/commands/g/model.js"
import { service } from "../src/commands/g/service.js"
import { validator } from "../src/commands/g/validator.js"

const root = join(import.meta.dirname, "..")
const fixtures = join(root, "fixtures")

let app: string
let originalCwd: string
let stdout: string[] = []
let stderr: string[] = []
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
  restore = [capture(process.stdout, stdout), capture(process.stderr, stderr)]
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

const read = (path: string): string => readFileSync(join(app, path), "utf8")
const has = (path: string): boolean => existsSync(join(app, path))

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

beforeAll(() => {
  app = mkdtempSync(join(tmpdir(), "wee-db-"))
  cpSync(join(fixtures, "single-repo"), app, { recursive: true })
  // The generated app resolves drizzle, better-sqlite3 and vitest from wee's own tree.
  symlinkSync(join(root, "node_modules"), join(app, "node_modules"))
  writeFileSync(join(app, ".env"), "DATABASE_URL=./local.sqlite\n")
  originalCwd = process.cwd()
  process.chdir(app)
})

afterAll(() => {
  process.chdir(originalCwd)
  rmSync(app, { recursive: true, force: true })
})

describe("phase 1 on sqlite", () => {
  it("db:init writes the drizzle scaffold and config", async () => {
    const { exit, err } = await run(dbInit, [
      "--adapter=drizzle",
      "--provider=sqlite",
      "--skip-install",
    ])
    expect(err).toBe("")
    expect(exit).toBe(0)
    expect(has("drizzle.config.ts")).toBe(true)
    expect(has("src/db/client.ts")).toBe(true)
    expect(has("src/db/seed.ts")).toBe(true)
    expect(JSON.parse(read(".app/config.json")).db).toEqual({
      adapter: "drizzle",
      provider: "sqlite",
      schemaDir: "db/schema",
      migrationsDir: "db/migrations",
    })
    expect(JSON.parse(read("package.json")).scripts["db:migrate"]).toBe(
      "wee db:migrate"
    )
    expect(read(".env.example")).toContain("DATABASE_URL=./local.sqlite")
    expect(read(".gitignore")).toContain("*.sqlite")
  })

  it("db:init refuses to run twice without --force", async () => {
    const { exit, err } = await run(dbInit, [
      "--provider=sqlite",
      "--skip-install",
    ])
    expect(exit).toBe(1)
    expect(err).toContain("db-already-initialised")
  })

  it("g model writes model, validator, service and migration", async () => {
    const { exit, err } = await run(model, [
      "Post",
      "title:string",
      "body:text:optional",
      "views:integer:default=0",
      "status:enum[draft,published]",
    ])
    expect(err).toBe("")
    expect(exit).toBe(0)
    const source = read("src/db/schema/posts.ts")
    expect(source).toContain("const posts = sqliteTable(")
    expect(source).toContain('title: text("title").notNull()')
    expect(source).toContain('body: text("body"),')
    expect(source).toContain('views: integer("views").notNull().default(0)')
    expect(source).toContain(
      'status: text("status", { enum: ["draft", "published"] }).notNull()'
    )
    expect(read("src/db/schema/index.ts")).toContain('export * from "./posts"')
    expect(has("src/lib/validators/post.ts")).toBe(true)
    expect(has("src/lib/validators/post.test.ts")).toBe(true)
    expect(has("src/services/posts.ts")).toBe(true)
    expect(read("src/db/migrations/0000_create_posts.sql")).toContain(
      "CREATE TABLE `posts`"
    )
    expect(read("src/db/migrations/0000_create_posts.down.sql")).toBe(
      'DROP TABLE "posts";\n'
    )
    const journal = JSON.parse(
      read("src/db/migrations/meta/_journal.json")
    ) as { entries: Array<{ tag: string }> }
    expect(journal.entries.map((entry) => entry.tag)).toEqual([
      "0000_create_posts",
    ])
  })

  it("the generated validator test passes", async () => {
    const result = await x(
      "node",
      [
        join(app, "node_modules/vitest/vitest.mjs"),
        "run",
        "src/lib/validators",
      ],
      {
        nodeOptions: { cwd: app },
        throwOnError: false,
      }
    )
    expect(`${result.stdout}${result.stderr}`).toContain("2 passed")
    expect(result.exitCode).toBe(0)
  }, 30_000)

  it("db:migrate creates a queryable table and db:status reports it applied", async () => {
    expect((await run(dbMigrate, [])).exit).toBe(0)
    expect(await tables()).toEqual(["__drizzle_migrations", "posts"])
    const { out } = await run(dbStatus, [])
    expect(JSON.parse(out)).toEqual([
      expect.objectContaining({ action: "applied", path: "0000_create_posts" }),
    ])
  })

  it("g migration AddXToY edits the model and writes up and down SQL", async () => {
    const { exit, err } = await run(migration, [
      "AddSlugToPosts",
      "slug:string:optional:index",
    ])
    expect(err).toBe("")
    expect(exit).toBe(0)
    const source = read("src/db/schema/posts.ts")
    expect(source).toContain('slug: text("slug"),')
    expect(source).toContain('index("posts_slug_idx").on(table.slug)')
    expect(read("src/db/migrations/0001_add_slug_to_posts.sql")).toContain(
      "ADD `slug` text"
    )
    expect(read("src/db/migrations/0001_add_slug_to_posts.down.sql")).toBe(
      'DROP INDEX "posts_slug_idx";\n--> statement-breakpoint\nALTER TABLE "posts" DROP COLUMN "slug";\n'
    )
    expect((await run(dbMigrate, [])).exit).toBe(0)
  })

  it("g migration with a custom name writes an empty migration that db:migrate refuses", async () => {
    const { exit } = await run(migration, ["BackfillSlugs"])
    expect(exit).toBe(0)
    expect(has("src/db/migrations/0002_backfill_slugs.sql")).toBe(true)
    expect(read("src/db/migrations/0002_backfill_slugs.down.sql")).toContain(
      "-- Down migration"
    )
    const migrated = await run(dbMigrate, [])
    expect(migrated.exit).toBe(1)
    expect(migrated.err).toContain("migration-empty")
    writeFileSync(
      join(app, "src/db/migrations/0002_backfill_slugs.sql"),
      "UPDATE posts SET slug = title;\n"
    )
  })

  it("g migration AddXToY without attributes fails", async () => {
    const { exit, err } = await run(migration, ["AddKindToPosts"])
    expect(exit).toBe(1)
    expect(err).toContain("attributes-required")
  })

  it("db:rollback --step reverts applied migrations in reverse order", async () => {
    const migrated = await run(dbMigrate, [])
    expect(migrated.err).toBe("")
    expect(migrated.exit).toBe(0)
    const { out, err, exit } = await run(dbRollback, ["--step=2"])
    expect(err).toBe("")
    expect(exit).toBe(0)
    expect(JSON.parse(out).map((row: { path: string }) => row.path)).toEqual([
      "0002_backfill_slugs",
      "0001_add_slug_to_posts",
    ])
    const status = JSON.parse((await run(dbStatus, [])).out) as Array<{
      action: string
    }>
    expect(status.map((row) => row.action)).toEqual([
      "applied",
      "pending",
      "pending",
    ])
    expect(read("src/db/migrations/meta/_journal.json")).toContain(
      "0002_backfill_slugs"
    )
  })

  it("destroy migration removes the latest migration and restores the model", async () => {
    // The custom migration was edited by hand above, so destroy needs --force.
    const first = await run(destroy, ["migration", "backfill_slugs", "--force"])
    expect(first.err).toBe("")
    expect(first.exit).toBe(0)
    const { exit } = await run(destroy, ["migration", "add_slug_to_posts"])
    expect(exit).toBe(0)
    expect(read("src/db/schema/posts.ts")).not.toContain("slug")
    expect(has("src/db/migrations/0001_add_slug_to_posts.sql")).toBe(false)
    expect(has("src/db/migrations/meta/0001_snapshot.json")).toBe(false)
  })

  it("g validator and g service reuse the model manifest attributes", async () => {
    rmSync(join(app, "src/lib/validators/post.ts"))
    rmSync(join(app, "src/services/posts.ts"))
    expect((await run(validator, ["Post", "--force"])).exit).toBe(0)
    expect(read("src/lib/validators/post.ts")).toContain(
      "status: z.enum(postStatusValues)"
    )
    expect((await run(service, ["Post"])).exit).toBe(0)
    expect(read("src/services/posts.ts")).toContain("const listPosts")
  })

  it("db:reset drops and rebuilds the database, db:prepare is idempotent", async () => {
    expect((await run(dbReset, [])).exit).toBe(0)
    expect(await tables()).toEqual(["__drizzle_migrations", "posts"])
    const { out, exit } = await run(dbPrepare, [])
    expect(exit).toBe(0)
    expect(JSON.parse(out)).toEqual([
      { action: "exists", path: "database" },
      { action: "migrated", path: "" },
      { action: "not-seeded", path: "" },
    ])
  })

  it("db:reset refuses in production", async () => {
    process.env.APP_ENV = "production"
    const { exit, err } = await run(dbReset, [])
    delete process.env.APP_ENV
    expect(exit).toBe(1)
    expect(err).toContain("reset-refused")
  })

  it("destroy model reverses the model run", async () => {
    await run(dbRollback, ["--step=1"])
    const { exit } = await run(destroy, ["model", "Post", "--force"])
    expect(exit).toBe(0)
    expect(has("src/db/schema/posts.ts")).toBe(false)
    expect(read("src/db/schema/index.ts")).not.toContain("posts")
    expect(has("src/db/migrations/meta/_journal.json")).toBe(false)
  })
})
