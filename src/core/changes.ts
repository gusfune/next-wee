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
import { dirname, isAbsolute, join } from "node:path"
import { z } from "zod"
import type { Context } from "./context.js"
import { WeeError } from "./errors.js"
import { injectBlock } from "./inject.js"

/**
 * A path relative to the target app that stays inside it. Custom generators
 * and manifests on disk are untrusted input, so `..` and absolute paths fail.
 */
const relativePath = z
  .string()
  .min(1)
  .refine((path) => !isAbsolute(path) && !path.split(/[\\/]/).includes(".."), {
    message: "must be relative to the app and must not contain ..",
  })

const fileChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    path: relativePath,
    content: z.string(),
  }),
  z.object({
    kind: z.literal("modify"),
    path: relativePath,
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
    path: relativePath,
    content: z.string(),
  }),
  z.object({
    kind: z.literal("inject"),
    path: relativePath,
    marker: z.string(),
    content: z.string(),
    after: z.string().optional(),
  }),
  z.object({ kind: z.literal("delete"), path: relativePath }),
])

/** One planned change. A schema, because custom generators return these over the wire. */
type FileChange = z.output<typeof fileChangeSchema>

const appliedChangeSchema = z.object({
  kind: z.enum(["create", "modify", "ensure", "inject", "delete"]),
  path: relativePath,
  /** sha256 of the file after the change. Absent for deletes. */
  hash: z.string().optional(),
  /** Marker id for inject changes. */
  marker: z.string().optional(),
  /** Full previous content for modify and delete changes so `destroy` can restore it. */
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

/**
 * Applies changes in order. Every change is planned in memory first, so a
 * failing check leaves the disk untouched and a run never ends half written
 * without a manifest. In dry-run mode it plans and returns without writing.
 */
const applyChanges = (options: ApplyOptions): AppliedChange[] => {
  const { root, changes, dryRun } = options
  // Planned content per path; `undefined` means the file is deleted.
  const planned = new Map<string, string | undefined>()
  const current = (path: string): string | undefined =>
    planned.has(path) ? planned.get(path) : readIfExists(join(root, path))
  const applied: AppliedChange[] = []
  for (const change of changes) {
    const before = current(change.path)
    switch (change.kind) {
      case "create": {
        if (before !== undefined) {
          throw new WeeError(
            "file-exists",
            `${change.path} exists. Use destroy first or pick another name.`
          )
        }
        planned.set(change.path, change.content)
        applied.push({
          kind: "create",
          path: change.path,
          hash: sha256(change.content),
        })
        break
      }
      case "modify": {
        if (before === undefined) {
          throw new WeeError(
            "file-missing",
            `${change.path} does not exist and cannot be modified`
          )
        }
        planned.set(change.path, change.content)
        applied.push({
          kind: "modify",
          path: change.path,
          hash: sha256(change.content),
          previous: before,
        })
        break
      }
      case "ensure": {
        if (before === undefined) {
          planned.set(change.path, change.content)
        }
        applied.push({ kind: "ensure", path: change.path })
        break
      }
      case "inject": {
        const next = injectBlock({
          source: before ?? "",
          path: change.path,
          id: change.marker,
          content: change.content,
          after: change.after,
        })
        planned.set(change.path, next)
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
        planned.set(change.path, undefined)
        applied.push({
          kind: "delete",
          path: change.path,
          ...(before === undefined ? {} : { previous: before }),
        })
        break
      }
    }
  }
  if (!dryRun) {
    for (const [path, content] of planned) {
      const file = join(root, path)
      if (content === undefined) {
        rmSync(file, { force: true })
      } else {
        writeFile(file, content)
      }
    }
  }
  return applied
}

/**
 * `create` for a new file, `modify` when it exists and `--force` is set;
 * throws otherwise.
 */
const createOrReplace = (
  ctx: Pick<Context, "target" | "flags">,
  path: string,
  content: string
): FileChange => {
  const exists = existsSync(join(ctx.target.path, path))
  if (exists && !ctx.flags.force) {
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
