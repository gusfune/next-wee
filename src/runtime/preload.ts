/**
 * Preload for `wee console` and `wee runner`. This file runs inside the
 * target app (through bun or `node --import tsx`), never inside the CLI
 * process, so it uses Node builtins only. It loads the app's `db`, schema,
 * services and auth module, then opens a REPL or evaluates one expression
 * or file. `--sandbox` wraps the session in a transaction and rolls back.
 */
import { existsSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, join } from "node:path"
import { start } from "node:repl"
import { pathToFileURL } from "node:url"
import { inspect, parseArgs } from "node:util"

const { values } = parseArgs({
  options: {
    app: { type: "string" },
    src: { type: "string" },
    schema: { type: "string" },
    provider: { type: "string" },
    adapter: { type: "string" },
    mode: { type: "string" },
    sandbox: { type: "boolean", default: false },
    file: { type: "string" },
    expr: { type: "string" },
  },
  strict: true,
})

const required = (
  name: "app" | "src" | "schema" | "provider" | "adapter" | "mode"
): string => {
  const value = values[name]
  if (value === undefined) {
    throw new Error(`preload: --${name} is required`)
  }
  return value
}

const app = required("app")
const src = required("src")
const schemaDir = required("schema")
const provider = required("provider")
const adapter = required("adapter")
const mode = required("mode")

type Module = Record<string, unknown>

const importIfExists = async (file: string): Promise<Module | undefined> =>
  existsSync(file)
    ? ((await import(pathToFileURL(file).href)) as Module)
    : undefined

const camelCase = (name: string): string =>
  name.replace(/[-_]([a-z0-9])/g, (_, char: string) => char.toUpperCase())

/** The `auth` instance when `lib/auth` exports one, else the whole module. */
const authScope = (module: Module | undefined): Module | undefined =>
  module === undefined
    ? undefined
    : typeof module.auth === "object" && module.auth !== null
      ? (module.auth as Module)
      : module

/** Every `services/*.ts` module keyed by its camelCase file name. */
const loadServices = async (): Promise<Record<string, Module>> => {
  const dir = join(src, "services")
  if (!existsSync(dir)) {
    return {}
  }
  const services: Record<string, Module> = {}
  const files = readdirSync(dir).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts")
  )
  for (const name of files) {
    const module = await importIfExists(join(dir, name))
    if (module !== undefined) {
      services[camelCase(basename(name, ".ts"))] = module
    }
  }
  return services
}

interface Scope {
  db: unknown
  schema: Module | undefined
  services: Record<string, Module>
  auth: Module | undefined
}

const scope: Scope = {
  db: (await importIfExists(join(src, "db", "client.ts")))?.db,
  schema: await importIfExists(join(schemaDir, "index.ts")),
  services: await loadServices(),
  auth: authScope(await importIfExists(join(src, "lib", "auth", "index.ts"))),
}

const banner = (): string => {
  const loaded = [
    scope.db === undefined ? undefined : "db",
    scope.schema === undefined
      ? undefined
      : `schema (${Object.keys(scope.schema).length} exports)`,
    `services (${Object.keys(scope.services).join(", ") || "none"})`,
    scope.auth === undefined ? undefined : "auth",
  ].filter((item) => item !== undefined)
  const sandbox = values.sandbox ? " Sandbox: changes roll back on exit." : ""
  return `Loaded: ${loaded.join(", ")}.${sandbox} Type exit to leave.`
}

/** Exit code from a result: `false` fails, anything else passes. */
const codeFor = (result: unknown): number => (result === false ? 1 : 0)

const runConsole = (db: unknown): Promise<number> =>
  new Promise((resolve) => {
    process.stdout.write(`${banner()}\n`)
    const server = start({ prompt: "wee> " })
    Object.assign(server.context, { ...scope, db })
    // `exit` closes the session like Rails; `.exit` and Ctrl-D still work.
    Object.defineProperty(server.context, "exit", {
      get: () => {
        server.close()
        return undefined
      },
    })
    server.on("exit", () => resolve(0))
  })

const runExpression = async (db: unknown, expr: string): Promise<number> => {
  // A function body, so `await` works and the scope names are parameters.
  const AsyncFunction = Object.getPrototypeOf(async () => {})
    .constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<unknown>
  const fn = new AsyncFunction(
    "db",
    "schema",
    "services",
    "auth",
    `return (${expr})`
  )
  const result = await fn(db, scope.schema, scope.services, scope.auth)
  process.stdout.write(`${inspect(result, { depth: 4 })}\n`)
  return codeFor(result)
}

const runFile = async (db: unknown, file: string): Promise<number> => {
  Object.assign(globalThis, { ...scope, db })
  const module = (await import(pathToFileURL(file).href)) as Module
  const main = module.default
  if (typeof main !== "function") {
    return 0
  }
  return codeFor(await main({ ...scope, db }))
}

const body = async (db: unknown): Promise<number> => {
  if (mode === "console") {
    return runConsole(db)
  }
  if (values.expr !== undefined) {
    return runExpression(db, values.expr)
  }
  if (values.file !== undefined) {
    return runFile(db, values.file)
  }
  throw new Error("preload: --expr or --file is required in runner mode")
}

interface SqliteDb {
  run: (query: unknown) => unknown
}

interface TransactionDb {
  transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>
}

interface PrismaDb {
  $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>
}

/**
 * Prisma rolls back an interactive transaction when the callback throws.
 * The transaction client is exposed as `db`; services import the shared
 * client and still write outside it.
 */
const runInPrismaSandbox = async (db: PrismaDb): Promise<number> => {
  const rollback = Symbol("rollback")
  let code: number | undefined
  try {
    await db.$transaction(async (tx) => {
      code = await body(tx)
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) {
      throw error
    }
  }
  return code ?? 1
}

/**
 * SQLite drivers are synchronous, so the session runs between BEGIN and
 * ROLLBACK on the same connection. Postgres and MySQL run inside
 * `db.transaction` with the transaction handle exposed as `db`; services
 * that import the pooled client still write outside it.
 */
const runInSandbox = async (): Promise<number> => {
  const { db } = scope
  if (db === undefined || db === null) {
    throw new Error("preload: --sandbox needs src/db/client.ts")
  }
  if (adapter === "prisma") {
    // Claim: the generated Prisma client always has `$transaction`.
    return runInPrismaSandbox(db as PrismaDb)
  }
  const require = createRequire(join(app, "package.json"))
  const { sql } = require("drizzle-orm") as {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown
  }
  if (provider === "sqlite") {
    // Claim: a Drizzle better-sqlite3 client always has `run`.
    const sqlite = db as SqliteDb
    sqlite.run(sql`BEGIN`)
    try {
      return await body(db)
    } finally {
      sqlite.run(sql`ROLLBACK`)
    }
  }
  // Claim: Drizzle postgres-js and mysql2 clients always have `transaction`.
  const pooled = db as TransactionDb
  let code: number | undefined
  try {
    await pooled.transaction(async (tx) => {
      code = await body(tx)
      // Drizzle rolls back by throwing; the throw is expected below.
      ;(tx as { rollback: () => never }).rollback()
    })
  } catch (error) {
    if (code === undefined) {
      throw error
    }
  }
  return code ?? 1
}

try {
  const code = values.sandbox ? await runInSandbox() : await body(scope.db)
  process.exit(code)
} catch (error) {
  process.stderr.write(`${inspect(error)}\n`)
  process.exit(1)
}
