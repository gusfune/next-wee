/**
 * File templates for the Prisma adapter. The schema is a folder: one
 * `schema.prisma` with the datasource and generator, one `<table>.prisma`
 * per model. The client is generated into `<src>/db/generated`.
 */
import type { DbProvider, ModelSpec } from "../../core/adapters.js"
import { camelCase, kebabCase, plural } from "../../lib/inflect.js"
import {
  backRelationLine,
  enumBlock,
  fieldRows,
  formatFields,
  indexLine,
  systemRows,
} from "./fields.js"

interface DbPaths {
  /** Source root relative to the app: `src` or `.`. */
  src: string
  /** Schema dir relative to the app, e.g. `src/db/schema`. */
  schemaDir: string
  /** Migrations dir relative to the app, e.g. `src/db/migrations`. */
  migrationsDir: string
  /** Generated client dir relative to the app, e.g. `src/db/generated`. */
  generatedDir: string
}

const DEFAULT_URL: Record<DbProvider, (app: string) => string> = {
  postgres: (app) => `postgres://postgres:postgres@localhost:5432/${app}_local`,
  sqlite: () => "file:./local.sqlite",
  mysql: (app) => `mysql://root:root@localhost:3306/${app}_local`,
}

/** Datasource provider names as Prisma spells them. */
const PRISMA_PROVIDER: Record<DbProvider, string> = {
  postgres: "postgresql",
  sqlite: "sqlite",
  mysql: "mysql",
}

const ADAPTER: Record<DbProvider, { package: string; className: string }> = {
  postgres: { package: "@prisma/adapter-pg", className: "PrismaPg" },
  sqlite: {
    package: "@prisma/adapter-better-sqlite3",
    className: "PrismaBetterSqlite3",
  },
  mysql: { package: "@prisma/adapter-mariadb", className: "PrismaMariaDb" },
}

interface PrismaConfigOptions {
  paths: DbPaths
  /** Fallback when DATABASE_URL is unset, the same value `.env.example` gets. */
  defaultUrl: string
}

const prismaConfigTemplate = (options: PrismaConfigOptions): string => {
  const { paths, defaultUrl } = options
  return `/** Prisma CLI config. Written by \`wee db:init\`; the client reads DATABASE_URL itself. */
import { defineConfig } from "prisma/config"

export default defineConfig({
  schema: "${paths.schemaDir}",
  migrations: { path: "${paths.migrationsDir}" },
  datasource: { url: process.env.DATABASE_URL ?? "${defaultUrl}" },
})
`
}

/** `schema.prisma`: datasource and generator only. Models live in sibling files. */
const baseSchemaTemplate = (
  provider: DbProvider,
  generatedFromSchema: string
): string => `datasource db {
  provider = "${PRISMA_PROVIDER[provider]}"
}

generator client {
  provider = "prisma-client"
  output   = "${generatedFromSchema}"
}
`

const clientTemplate = (provider: DbProvider): string => {
  const adapter = ADAPTER[provider]
  const construct =
    provider === "sqlite"
      ? `new ${adapter.className}({ url: process.env.DATABASE_URL ?? "${DEFAULT_URL.sqlite("")}" })`
      : `new ${adapter.className}(process.env.DATABASE_URL ?? "")`
  return `/** Prisma client. Import it from services only. */
import { ${adapter.className} } from "${adapter.package}"
import { PrismaClient } from "./generated/client"

const adapter = ${construct}
const db = new PrismaClient({ adapter })
type Db = typeof db

export type { Db }
export { db }
`
}

const seedRunnerTemplate = (): string => `/**
 * Seed runner. Runs every file in ./seeds in name order, or one file with
 * --file <name>. --replant calls each seed's \`replant(db)\` before it runs.
 * Each seed exports \`seed(db)\` and, for replant, \`replant(db)\`.
 */
import { readdirSync } from "node:fs"
import { parseArgs } from "node:util"
import type { Db } from "./client"
import { db } from "./client"

interface SeedModule {
  replant?: (db: Db) => Promise<unknown>
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
  if (values.replant && seed.replant !== undefined) {
    await seed.replant(db)
  }
  await seed.seed(db)
  console.log(\`seeded \${file}\`)
}

await db.$disconnect()
`

const seedsReadmeTemplate = (): string => `# Seeds

One file per table. Each file exports \`seed(db)\` and, for replant, \`replant(db)\`. Seeds must be idempotent: upsert, do not insert.

\`\`\`ts
import type { Db } from "../client"

export const replant = (db: Db) => db.post.deleteMany()

export const seed = async (db: Db): Promise<void> => {
  const id = "00000000-0000-4000-8000-000000000001"
  await db.post.upsert({ where: { id }, update: {}, create: { id, title: "Hello" } })
}
\`\`\`

Run with \`wee db:seed\`, one file with \`wee db:seed --file posts\`, or wipe and refill with \`wee db:seed:replant\`.
`

const modelFile = (model: Pick<ModelSpec, "table">): string =>
  `${kebabCase(model.table)}.prisma`

const modelTemplate = (provider: DbProvider, model: ModelSpec): string => {
  const system = systemRows(provider)
  const rows = [
    system.id,
    ...model.attributes.flatMap((attribute) =>
      fieldRows(provider, model.table, attribute)
    ),
    system.createdAt,
    system.updatedAt,
  ]
  const enums = model.attributes.filter(
    (attribute) => attribute.type === "enum"
  )
  const indexed = model.attributes.filter((attribute) => attribute.index)
  const lines: string[] = []
  for (const attribute of enums) {
    lines.push(enumBlock(model.table, attribute), "")
  }
  lines.push(`model ${model.name} {`, ...formatFields(rows), "")
  for (const attribute of indexed) {
    lines.push(`  ${indexLine(attribute)}`)
  }
  lines.push(`  @@map("${model.table}")`, "}", "")
  return lines.join("\n")
}

interface ServiceImports {
  /** Relative import of `db/client`, e.g. `../db/client`. */
  client: string
  /** Relative import of the generated client, e.g. `../db/generated/client`. */
  generated: string
}

const serviceTemplate = (model: ModelSpec, imports: ServiceImports): string => {
  const name = model.name
  const names = plural(name)
  const delegate = `db.${camelCase(name)}`
  return `/** Data access for ${names}. The only module that may import the database client. */
import "server-only"
import { db } from "${imports.client}"
import type { ${name}, Prisma } from "${imports.generated}"

type New${name} = Prisma.${name}UncheckedCreateInput

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
  return (await ${delegate}.findUnique({ where: { id } })) ?? undefined
}

const list${names} = async (options: List${names}Options = {}): Promise<${name}Page> => {
  const page = options.page ?? 1
  const perPage = options.perPage ?? 20
  const [rows, total] = await Promise.all([
    ${delegate}.findMany({
      orderBy: { createdAt: "desc" },
      take: perPage,
      skip: (page - 1) * perPage,
    }),
    ${delegate}.count(),
  ])
  return { rows, total, page, perPage }
}

const create${name} = async (input: New${name}): Promise<${name}> => {
  return ${delegate}.create({ data: input })
}

const update${name} = async (id: string, input: Partial<New${name}>): Promise<${name} | undefined> => {
  const { count } = await ${delegate}.updateMany({ where: { id }, data: input })
  return count === 0 ? undefined : get${name}(id)
}

const remove${name} = async (id: string): Promise<void> => {
  await ${delegate}.deleteMany({ where: { id } })
}

export type { List${names}Options, ${name}Page }
export { create${name}, get${name}, list${names}, remove${name}, update${name} }
`
}

export type { DbPaths, PrismaConfigOptions, ServiceImports }
export {
  ADAPTER,
  backRelationLine,
  baseSchemaTemplate,
  clientTemplate,
  DEFAULT_URL,
  modelFile,
  modelTemplate,
  PRISMA_PROVIDER,
  prismaConfigTemplate,
  seedRunnerTemplate,
  seedsReadmeTemplate,
  serviceTemplate,
}
