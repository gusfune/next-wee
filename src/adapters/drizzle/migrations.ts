/**
 * Migration files for the Drizzle adapter. drizzle-kit owns the up SQL and
 * the journal. `generateMigration` runs it against a scratch copy of the
 * schema so the result is a FileChange list: dry-run shows it, apply
 * writes it, destroy reverses it. The down SQL sits beside the up SQL as
 * `<tag>.down.sql` and is run by `db:rollback`.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { join, relative } from "node:path"
import type {
  Attribute,
  DbProvider,
  SchemaChange,
} from "../../core/adapters.js"
import type { FileChange } from "../../core/changes.js"
import { applyChanges, readIfExists } from "../../core/changes.js"
import { CONFIG_DIR } from "../../core/config.js"
import type { Context } from "../../core/context.js"
import { WeeError } from "../../core/errors.js"
import { runBin } from "../../lib/packages.js"
import { quoteIdentifier } from "../driver.js"
import { dbDirs } from "../shared.js"
import { enumName } from "../validator.js"
import { columnDefinitionSql, KIT_DIALECT } from "./columns.js"

const BREAKPOINT = "--> statement-breakpoint"

interface JournalEntry {
  idx: number
  version: string
  when: number
  tag: string
  breakpoints: boolean
}

interface Journal {
  version: string
  dialect: string
  entries: JournalEntry[]
}

const readJournal = (dir: string): Journal | undefined => {
  const text = readIfExists(join(dir, "meta", "_journal.json"))
  return text === undefined ? undefined : (JSON.parse(text) as Journal)
}

const joinStatements = (statements: string[]): string =>
  statements
    .map((statement) => `${statement.trim()};`)
    .join(`\n${BREAKPOINT}\n`)

/** SQL that reverses a schema change. Empty for custom migrations. */
const downSql = (provider: DbProvider, change: SchemaChange): string => {
  const q = (name: string): string => quoteIdentifier(provider, name)
  const dropEnums = (table: string, attributes: Attribute[]): string[] =>
    provider === "postgres"
      ? attributes
          .filter((attribute) => attribute.type === "enum")
          .map(
            (attribute) => `DROP TYPE ${q(enumName(table, attribute).sqlName)}`
          )
      : []
  const indexSql = (table: string, attribute: Attribute): string[] => {
    const statements: string[] = []
    if (attribute.index) {
      statements.push(
        `CREATE INDEX ${q(`${table}_${attribute.column}_idx`)} ON ${q(table)} (${q(attribute.column)})`
      )
    }
    if (attribute.unique && provider === "sqlite") {
      statements.push(
        `CREATE UNIQUE INDEX ${q(`${table}_${attribute.column}_unique`)} ON ${q(table)} (${q(attribute.column)})`
      )
    }
    return statements
  }
  // Postgres and MySQL drop dependent indexes with the column. SQLite refuses
  // to drop a column an index still references, so drop the indexes first.
  const dropIndexSql = (table: string, attribute: Attribute): string[] =>
    provider === "sqlite"
      ? [
          ...(attribute.index
            ? [`DROP INDEX ${q(`${table}_${attribute.column}_idx`)}`]
            : []),
          ...(attribute.unique
            ? [`DROP INDEX ${q(`${table}_${attribute.column}_unique`)}`]
            : []),
        ]
      : []
  switch (change.kind) {
    case "create-table":
      return joinStatements([
        `DROP TABLE ${q(change.model.table)}`,
        ...dropEnums(change.model.table, change.model.attributes),
      ])
    case "create-tables":
      return joinStatements(
        change.models
          .toReversed()
          .flatMap((model) => [
            `DROP TABLE ${q(model.table)}`,
            ...dropEnums(model.table, model.attributes),
          ])
      )
    case "add-columns":
      return joinStatements([
        ...change.attributes.flatMap((attribute) => [
          ...dropIndexSql(change.table, attribute),
          `ALTER TABLE ${q(change.table)} DROP COLUMN ${q(attribute.column)}`,
        ]),
        ...dropEnums(change.table, change.attributes),
      ])
    case "remove-columns":
      return joinStatements(
        change.attributes.flatMap((attribute) => [
          `ALTER TABLE ${q(change.table)} ADD COLUMN ${columnDefinitionSql(provider, change.table, attribute)}`,
          ...indexSql(change.table, attribute),
        ])
      )
    case "custom":
      return "-- Down migration. Reverse the custom SQL here.\n"
  }
}

interface GenerateOptions {
  ctx: Context
  provider: DbProvider
  name: string
  change: SchemaChange
  pending: FileChange[]
}

/** Runs drizzle-kit generate on a scratch copy and returns the new migration files as changes. */
const generateMigration = async (
  options: GenerateOptions
): Promise<FileChange[]> => {
  const { ctx, provider, name, change, pending } = options
  const target = ctx.target.path
  const { schemaDir, migrationsDir } = dbDirs(ctx)
  const configDir = join(target, CONFIG_DIR)
  const hadConfigDir = existsSync(configDir)
  mkdirSync(configDir, { recursive: true })
  const scratch = mkdtempSync(join(configDir, "wee-"))
  try {
    const scratchSchema = join(scratch, "schema")
    const scratchOut = join(scratch, "out")
    if (existsSync(join(target, schemaDir))) {
      cpSync(join(target, schemaDir), scratchSchema, { recursive: true })
    }
    mkdirSync(scratchSchema, { recursive: true })
    const schemaPending = pending
      .filter((item) => !relative(schemaDir, item.path).startsWith(".."))
      .map((item) => ({
        ...item,
        path: join("schema", relative(schemaDir, item.path)),
      }))
    applyChanges({ root: scratch, changes: schemaPending, dryRun: false })
    if (existsSync(join(target, migrationsDir, "meta"))) {
      cpSync(join(target, migrationsDir, "meta"), join(scratchOut, "meta"), {
        recursive: true,
      })
    }
    const before = readJournal(scratchOut)
    // drizzle-kit prefixes `--out` with "./" when it reads old snapshots, so
    // the paths must be relative to the target. It also exits 0 on error;
    // the journal comparison below is the real success check.
    const output = await runBin({
      targetPath: target,
      name: "drizzle-kit",
      args: [
        "generate",
        "--dialect",
        KIT_DIALECT[provider],
        "--schema",
        relative(target, scratchSchema),
        "--out",
        relative(target, scratchOut),
        "--name",
        name,
        ...(change.kind === "custom" ? ["--custom"] : []),
      ],
      stdio: "pipe",
    })
    const after = readJournal(scratchOut)
    const entry = after?.entries.at(-1)
    if (
      after === undefined ||
      entry === undefined ||
      entry.idx === before?.entries.at(-1)?.idx
    ) {
      const failed =
        /error/i.test(output.stdout) || /error/i.test(output.stderr)
      throw new WeeError(
        failed ? "drizzle-kit-failed" : "no-schema-changes",
        failed
          ? `${name}: drizzle-kit generate failed`
          : `${name}: the schema did not change, nothing to migrate`,
        { data: { stdout: output.stdout, stderr: output.stderr } }
      )
    }
    const upSql = readFileSync(join(scratchOut, `${entry.tag}.sql`), "utf8")
    const snapshot = `meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`
    return [
      {
        kind: "create",
        path: join(migrationsDir, `${entry.tag}.sql`),
        content: upSql,
      },
      {
        kind: "create",
        path: join(migrationsDir, `${entry.tag}.down.sql`),
        content: `${downSql(provider, change)}\n`,
      },
      {
        kind: "create",
        path: join(migrationsDir, snapshot),
        content: readFileSync(join(scratchOut, snapshot), "utf8"),
      },
      {
        kind: before === undefined ? "create" : "modify",
        path: join(migrationsDir, "meta/_journal.json"),
        content: readFileSync(join(scratchOut, "meta/_journal.json"), "utf8"),
      },
    ]
  } finally {
    rmSync(scratch, { recursive: true, force: true })
    if (!hadConfigDir) {
      rmSync(configDir, { recursive: true, force: true })
    }
  }
}

/** Splits SQL on the drizzle breakpoint marker and drops comment-only lines. */
const splitStatements = (text: string): string[] =>
  text
    .split(BREAKPOINT)
    .map((statement) =>
      statement
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter((statement) => statement.length > 0)

/** Statements of a down file. */
const readDownStatements = (migrationsDir: string, tag: string): string[] => {
  const text = readIfExists(join(migrationsDir, `${tag}.down.sql`))
  if (text === undefined) {
    throw new WeeError(
      "down-migration-missing",
      `${tag}.down.sql is missing. Write the reverse SQL there, then retry.`
    )
  }
  return splitStatements(text)
}

/**
 * drizzle-kit migrate exits 1 without a message when a migration file holds
 * no SQL (a custom migration nobody filled in). Fail with a reason instead.
 */
const assertMigrationsHaveSql = (migrationsDir: string): void => {
  const journal = readJournal(migrationsDir)
  for (const entry of journal?.entries ?? []) {
    const text = readIfExists(join(migrationsDir, `${entry.tag}.sql`)) ?? ""
    if (splitStatements(text).length === 0) {
      throw new WeeError(
        "migration-empty",
        `${entry.tag}.sql has no SQL. Write the custom migration, then retry.`
      )
    }
  }
}

export type { Journal, JournalEntry }
export {
  assertMigrationsHaveSql,
  downSql,
  generateMigration,
  readDownStatements,
  readJournal,
}
