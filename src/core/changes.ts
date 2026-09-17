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

type FileChange =
  | { kind: "create"; path: string; content: string }
  | { kind: "modify"; path: string; content: string }
  | {
      kind: "inject"
      path: string
      marker: string
      content: string
      after?: string | undefined
    }
  | { kind: "delete"; path: string }

const appliedChangeSchema = z.object({
  kind: z.enum(["create", "modify", "inject", "delete"]),
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
  describeChanges,
  readIfExists,
  sha256,
  writeFile,
}
