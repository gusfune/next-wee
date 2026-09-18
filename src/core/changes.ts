/**
 * FileChange is the unit of work for every generator. Generators return a
 * list and never touch the disk. `applyChanges` writes them, `--dry-run`
 * renders the same list. Paths are relative to the target app.
 */
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"
import { WeeError } from "./errors.js"
import { injectBlock } from "./inject.js"

const fileChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    path: z.string(),
    content: z.string(),
  }),
  z.object({
    kind: z.literal("modify"),
    path: z.string(),
    content: z.string(),
  }),
  /**
   * Creates the file when it is missing and leaves it alone otherwise. For
   * files shared by several runs (`actions.ts`, `env.ts`, `proxy.ts`).
   * `destroy` deletes it only when no other manifest and no marker block
   * refers to it.
   */
  z.object({
    kind: z.literal("ensure"),
    path: z.string(),
    content: z.string(),
  }),
  z.object({
    kind: z.literal("inject"),
    path: z.string(),
    marker: z.string(),
    content: z.string(),
    after: z.string().optional(),
  }),
  z.object({ kind: z.literal("delete"), path: z.string() }),
])

/** One planned change. A schema, because custom generators return these over the wire. */
type FileChange = z.output<typeof fileChangeSchema>

const appliedChangeSchema = z.object({
  kind: z.enum(["create", "modify", "ensure", "inject", "delete"]),
  path: z.string(),
  /** sha256 of the file after the change. Absent for deletes. */
  hash: z.string().optional(),
  /** Marker id for inject changes. */
  marker: z.string().optional(),
  /** Full previous content for modify changes so `destroy` can restore it. */
  previous: z.string().optional(),
})

type AppliedChange = z.output<typeof appliedChangeSchema>

const sha256 = (content: string): string =>
  createHash("sha256").update(content).digest("hex")

const readIfExists = (file: string): string | undefined => {
  return existsSync(file) ? readFileSync(file, "utf8") : undefined
}

const writeFile = (file: string, content: string): void => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content, "utf8")
}

interface ApplyOptions {
  root: string
  changes: FileChange[]
  dryRun: boolean
}

/** Applies changes in order. In dry-run mode it validates and returns without writing. */
const applyChanges = (options: ApplyOptions): AppliedChange[] => {
  const { root, changes, dryRun } = options
  const applied: AppliedChange[] = []
  for (const change of changes) {
    const file = join(root, change.path)
    switch (change.kind) {
      case "create": {
        if (existsSync(file)) {
          throw new WeeError(
            "file-exists",
            `${change.path} exists. Use destroy first or pick another name.`
          )
        }
        if (!dryRun) {
          writeFile(file, change.content)
        }
        applied.push({
          kind: "create",
          path: change.path,
          hash: sha256(change.content),
        })
        break
      }
      case "modify": {
        const previous = readIfExists(file)
        if (previous === undefined) {
          throw new WeeError(
            "file-missing",
            `${change.path} does not exist and cannot be modified`
          )
        }
        if (!dryRun) {
          writeFile(file, change.content)
        }
        applied.push({
          kind: "modify",
          path: change.path,
          hash: sha256(change.content),
          previous,
        })
        break
      }
      case "ensure": {
        if (!dryRun && !existsSync(file)) {
          writeFile(file, change.content)
        }
        applied.push({ kind: "ensure", path: change.path })
        break
      }
      case "inject": {
        const source = readIfExists(file) ?? ""
        const next = injectBlock({
          source,
          path: change.path,
          id: change.marker,
          content: change.content,
          after: change.after,
        })
        if (!dryRun) {
          writeFile(file, next)
        }
        // A file created earlier in this run now has the block too. Destroy
        // checks every hash before it reverses anything, so the create entry
        // must carry the final content.
        for (const earlier of applied) {
          if (earlier.path === change.path && earlier.hash !== undefined) {
            earlier.hash = sha256(next)
          }
        }
        applied.push({
          kind: "inject",
          path: change.path,
          hash: sha256(next),
          marker: change.marker,
        })
        break
      }
      case "delete": {
        if (!dryRun && existsSync(file)) {
          rmSync(file)
        }
        applied.push({ kind: "delete", path: change.path })
        break
      }
    }
  }
  return applied
}

interface CreateOrReplaceOptions {
  root: string
  force: boolean
  path: string
  content: string
}

/** `create` for a new file, `modify` when it exists and `force` is set; throws otherwise. */
const createOrReplace = (options: CreateOrReplaceOptions): FileChange => {
  const { root, force, path, content } = options
  const exists = existsSync(join(root, path))
  if (exists && !force) {
    throw new WeeError(
      "file-exists",
      `${path} exists. Pass --force to regenerate it.`
    )
  }
  return { kind: exists ? "modify" : "create", path, content }
}

type ChangeRow = { action: string; path: string }

const describeChanges = (changes: FileChange[]): ChangeRow[] => {
  return changes.map((change) => ({
    action: change.kind === "inject" ? `inject:${change.marker}` : change.kind,
    path: change.path,
  }))
}

export type { AppliedChange, ChangeRow, FileChange }
export {
  appliedChangeSchema,
  applyChanges,
  createOrReplace,
  describeChanges,
  fileChangeSchema,
  readIfExists,
  sha256,
  writeFile,
}
