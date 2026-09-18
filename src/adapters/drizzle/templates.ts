/**
 * File templates for the Drizzle adapter. Every template returns the full
 * file content. Generated files use relative imports so they work without
 * a path alias.
 */
import type { Attribute, DbProvider, ModelSpec } from "../../core/adapters.js"
import { camelCase, kebabCase, plural } from "../../lib/inflect.js"
import { enumName, quoteLiteral } from "../validator.js"
import {
  CORE_MODULE,
  columnCode,
  KIT_DIALECT,
  systemColumns,
  TABLE_FN,
} from "./columns.js"

interface DbPaths {
  /** Source root relative to the app: `src` or `.`. */
  src: string
  /** Schema dir relative to the app, e.g. `src/db/schema`. */
  schemaDir: string
  /** Migrations dir relative to the app, e.g. `src/db/migrations`. */
  migrationsDir: string
}

const DEFAULT_URL: Record<DbProvider, (app: string) => string> = {
  postgres: (app) => `postgres://postgres:postgres@localhost:5432/${app}_local`,
  sqlite: () => "./local.sqlite",
  mysql: (app) => `mysql://root:root@localhost:3306/${app}_local`,
}

const drizzleConfigTemplate = (
  provider: DbProvider,
  paths: DbPaths
): string => {
  const fallback =
    provider === "sqlite" ? quoteLiteral(DEFAULT_URL.sqlite("")) : '""'
  return `import { defineConfig } from "drizzle-kit"

/** Read by drizzle-kit. \`wee db:*\` loads .env.local and .env before it runs. */
export default defineConfig({
  dialect: "${KIT_DIALECT[provider]}",
  schema: "./${paths.schemaDir}",
  out: "./${paths.migrationsDir}",
  dbCredentials: { url: process.env.DATABASE_URL ?? ${fallback} },
})
`
}

const clientTemplate = (provider: DbProvider): string => {
  switch (provider) {
    case "postgres":
      return `/** Database client. Import it from services only. */
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

const client = postgres(process.env.DATABASE_URL ?? "")
const db = drizzle(client, { schema })

type Db = typeof db

export type { Db }
export { db }
`
    case "sqlite":
      return `/** Database client. Import it from services only. */
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import * as schema from "./schema"

const client = new Database(process.env.DATABASE_URL ?? "./local.sqlite")
const db = drizzle(client, { schema })

type Db = typeof db

export type { Db }
export { db }
`
    case "mysql":
      return `/** Database client. Import it from services only. */
import { drizzle } from "drizzle-orm/mysql2"
import * as schema from "./schema"

const db = drizzle(process.env.DATABASE_URL ?? "", { schema, mode: "default" })

type Db = typeof db

export type { Db }
export { db }
`
  }
}

const schemaIndexTemplate =
  (): string => `/** Schema barrel. \`wee g model\` adds an export per model. */
`

const seedRunnerTemplate = (): string => `/**
 * Seed runner. Runs every file in ./seeds in name order, or one file with
 * --file <name>. --replant deletes each seed's table before it runs.
 * Each seed exports \`seed(db)\` and, for replant, the \`table\` it fills.
 */
import { readdirSync } from "node:fs"
import { parseArgs } from "node:util"
import type { Db } from "./client"
import { db } from "./client"

interface SeedModule {
  table?: Parameters<Db["delete"]>[0]
  seed: (db: Db) => Promise<void>
}

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    replant: { type: "boolean", default: false },
  },
})

const files = readdirSync(new URL("./seeds", import.meta.url))
  .filter((file) => /\\.tsx?$/.test(file))
  .sort()
const selected =
  values.file === undefined
    ? files
    : files.filter((file) => file.replace(/\\.tsx?$/, "") === values.file)

if (selected.length === 0) {
  console.error(values.file === undefined ? "No seeds found" : \`No seed named \${values.file}\`)
  process.exit(1)
}

for (const file of selected) {
  const seed = (await import(\`./seeds/\${file}\`)) as SeedModule
  if (values.replant && seed.table !== undefined) {
    await db.delete(seed.table)
  }
  await seed.seed(db)
  console.log(\`seeded \${file}\`)
}
`

const seedsReadmeTemplate = (): string => `# Seeds

One file per table. Each file exports \`table\` and \`seed(db)\`. Seeds must be idempotent: check before insert.

\`\`\`ts
import type { Db } from "../client"
import { posts } from "../schema/posts"

export const table = posts

export const seed = async (db: Db): Promise<void> => {
  await db.insert(posts).values([{ title: "Hello" }]).onConflictDoNothing()
}
\`\`\`

Run with \`wee db:seed\`, one file with \`wee db:seed --file posts\`, or wipe and refill with \`wee db:seed:replant\`.
`

const modelFile = (model: ModelSpec): string => `${kebabCase(model.table)}.ts`

const modelTemplate = (provider: DbProvider, model: ModelSpec): string => {
  const system = systemColumns(provider)
  const columns = model.attributes.map((attribute) => ({
    attribute,
    ...columnCode(provider, model.table, attribute),
  }))
  const imports = new Set<string>([
    TABLE_FN[provider],
    ...system.id.imports,
    ...system.createdAt.imports,
    ...columns.flatMap((column) => column.imports),
  ])
  const indexed = model.attributes.filter((attribute) => attribute.index)
  if (indexed.length > 0) {
    imports.add("index")
  }
  const referenced = [
    ...new Set(
      model.attributes
        .map((attribute) => attribute.references)
        .filter((table): table is string => table !== undefined)
    ),
  ].sort()
  const enums = model.attributes.filter(
    (attribute) => attribute.type === "enum"
  )
  const table = camelCase(model.table)

  const lines: string[] = []
  lines.push(
    `import { ${[...imports].sort().join(", ")} } from "${CORE_MODULE[provider]}"`
  )
  for (const ref of referenced) {
    lines.push(`import { ${camelCase(ref)} } from "./${kebabCase(ref)}"`)
  }
  lines.push("")
  if (provider === "postgres") {
    for (const attribute of enums) {
      const { variable, sqlName } = enumName(model.table, attribute)
      const values = (attribute.values ?? []).map(quoteLiteral).join(", ")
      lines.push(`const ${variable} = pgEnum("${sqlName}", [${values}])`, "")
    }
  }
  lines.push(
    `const ${table} = ${TABLE_FN[provider]}(`,
    `  "${model.table}",`,
    "  {"
  )
  lines.push(`    id: ${system.id.code},`)
  for (const column of columns) {
    lines.push(`    ${column.attribute.name}: ${column.code},`)
  }
  lines.push(`    createdAt: ${system.createdAt.code},`)
  lines.push(`    updatedAt: ${system.updatedAt.code},`)
  if (indexed.length > 0) {
    lines.push("  },", "  (table) => [")
    for (const attribute of indexed) {
      lines.push(`    ${indexCode(model.table, attribute)},`)
    }
    lines.push("  ]", ")")
  } else {
    lines.push("  }", ")")
  }
  lines.push("")
  lines.push(`type ${model.name} = typeof ${table}.$inferSelect`)
  lines.push(`type New${model.name} = typeof ${table}.$inferInsert`)
  lines.push("")
  lines.push(`export type { New${model.name}, ${model.name} }`)
  const exported = [
    ...(provider === "postgres"
      ? enums.map((attribute) => enumName(model.table, attribute).variable)
      : []),
    table,
  ].sort()
  lines.push(`export { ${exported.join(", ")} }`)
  lines.push("")
  return lines.join("\n")
}

const indexCode = (table: string, attribute: Attribute): string =>
  `index("${table}_${attribute.column}_idx").on(table.${attribute.name})`

const serviceTemplate = (provider: DbProvider, model: ModelSpec): string => {
  const table = camelCase(model.table)
  const name = model.name
  const names = plural(name)
  const create =
    provider === "mysql"
      ? `const create${name} = async (input: New${name}): Promise<${name}> => {
  const id = input.id ?? crypto.randomUUID()
  await db.insert(${table}).values({ ...input, id })
  const row = await get${name}(id)
  if (row === undefined) {
    throw new Error("${name} was not inserted")
  }
  return row
}

const update${name} = async (id: string, input: Partial<New${name}>): Promise<${name} | undefined> => {
  await db.update(${table}).set(input).where(eq(${table}.id, id))
  return get${name}(id)
}`
      : `const create${name} = async (input: New${name}): Promise<${name}> => {
  const [row] = await db.insert(${table}).values(input).returning()
  if (row === undefined) {
    throw new Error("${name} was not inserted")
  }
  return row
}

const update${name} = async (id: string, input: Partial<New${name}>): Promise<${name} | undefined> => {
  const [row] = await db.update(${table}).set(input).where(eq(${table}.id, id)).returning()
  return row
}`
  return `/** Data access for ${names}. The only module that may import the database client. */
import "server-only"
import { count, desc, eq } from "drizzle-orm"
import { db } from "../db/client"
import type { New${name}, ${name} } from "../db/schema/${modelFile(model).replace(/\.ts$/, "")}"
import { ${table} } from "../db/schema/${modelFile(model).replace(/\.ts$/, "")}"

interface List${names}Options {
  page?: number
  perPage?: number
}

interface ${name}Page {
  rows: ${name}[]
  total: number
  page: number
  perPage: number
}

const get${name} = async (id: string): Promise<${name} | undefined> => {
  return db.query.${table}.findFirst({ where: eq(${table}.id, id) })
}

const list${names} = async (options: List${names}Options = {}): Promise<${name}Page> => {
  const page = options.page ?? 1
  const perPage = options.perPage ?? 20
  const [rows, totals] = await Promise.all([
    db.query.${table}.findMany({
      orderBy: desc(${table}.createdAt),
      limit: perPage,
      offset: (page - 1) * perPage,
    }),
    db.select({ total: count() }).from(${table}),
  ])
  return { rows, total: totals[0]?.total ?? 0, page, perPage }
}

${create}

const remove${name} = async (id: string): Promise<void> => {
  await db.delete(${table}).where(eq(${table}.id, id))
}

export type { List${names}Options, ${name}Page }
export { create${name}, get${name}, list${names}, remove${name}, update${name} }
`
}

export type { DbPaths }
export {
  clientTemplate,
  DEFAULT_URL,
  drizzleConfigTemplate,
  indexCode,
  modelFile,
  modelTemplate,
  schemaIndexTemplate,
  seedRunnerTemplate,
  seedsReadmeTemplate,
  serviceTemplate,
}
