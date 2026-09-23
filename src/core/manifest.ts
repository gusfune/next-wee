/**
 * Manifests record what a generator run wrote so `destroy` can reverse it.
 * One JSON file per run under `<app>/.app/manifests/<generator>-<name>.json`.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"
import { kebabCase } from "../lib/inflect.js"
import type { AppliedChange } from "./changes.js"
import { appliedChangeSchema } from "./changes.js"
import { CONFIG_DIR } from "./config.js"
import { WeeError } from "./errors.js"
import { readJsonFile } from "./json.js"

const MANIFEST_DIR = join(CONFIG_DIR, "manifests")

const manifestSchema = z.object({
  generator: z.string(),
  name: z.string(),
  createdAt: z.string(),
  cliVersion: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  changes: z.array(appliedChangeSchema),
})

type Manifest = z.output<typeof manifestSchema>

const manifestId = (generator: string, name: string): string => {
  return `${kebabCase(generator)}-${kebabCase(name)}`
}

const manifestPath = (
  targetPath: string,
  generator: string,
  name: string
): string => {
  return join(targetPath, MANIFEST_DIR, `${manifestId(generator, name)}.json`)
}

/** Changes to the same file (or the same injected block) share a key. */
const changeKey = (change: AppliedChange): string => {
  if (change.kind === "inject") {
    return `inject:${change.path}:${change.marker ?? ""}`
  }
  return change.kind === "ensure"
    ? `ensure:${change.path}`
    : `file:${change.path}`
}

/**
 * Folds a re-run (`--force`) into the earlier manifest. The earlier entry
 * keeps what the file was before wee touched it: a file the first run
 * created stays a create, and the first `previous` content wins, so
 * `destroy` still returns the app to the state before the first run.
 */
const mergeChanges = (
  earlier: AppliedChange[],
  later: AppliedChange[]
): AppliedChange[] => {
  const merged = new Map(earlier.map((change) => [changeKey(change), change]))
  for (const change of later) {
    const first = merged.get(changeKey(change))
    if (first === undefined) {
      merged.set(changeKey(change), change)
    } else if (first.previous !== undefined) {
      merged.set(changeKey(change), {
        ...change,
        kind: change.kind === "delete" ? "delete" : "modify",
        previous: first.previous,
      })
    } else if (first.kind === "create") {
      const { previous: _, ...rest } = change
      merged.set(changeKey(change), {
        ...rest,
        kind: change.kind === "delete" ? "delete" : "create",
      })
    } else {
      merged.set(changeKey(change), change)
    }
  }
  return [...merged.values()]
}

interface WriteManifestOptions {
  targetPath: string
  generator: string
  name: string
  cliVersion: string
  args?: Record<string, unknown>
  changes: AppliedChange[]
  dryRun: boolean
}

const writeManifest = (
  options: WriteManifestOptions
): { path: string; manifest: Manifest } => {
  const {
    targetPath,
    generator,
    name,
    cliVersion,
    args = {},
    changes,
    dryRun,
  } = options
  const file = manifestPath(targetPath, generator, name)
  const earlier = existsSync(file)
    ? readManifest(targetPath, generator, name).manifest.changes
    : []
  const manifest: Manifest = {
    generator,
    name,
    createdAt: new Date().toISOString(),
    cliVersion,
    args,
    changes: mergeChanges(earlier, changes),
  }
  if (!dryRun) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  }
  return { path: file, manifest }
}

const readManifest = (
  targetPath: string,
  generator: string,
  name: string
): { path: string; manifest: Manifest } => {
  const file = manifestPath(targetPath, generator, name)
  if (!existsSync(file)) {
    throw new WeeError(
      "manifest-missing",
      `No manifest for ${generator} ${name} at ${file}`
    )
  }
  return {
    path: file,
    manifest: readJsonFile(file, manifestSchema, "manifest-invalid"),
  }
}

const deleteManifest = (
  targetPath: string,
  generator: string,
  name: string
): void => {
  rmSync(manifestPath(targetPath, generator, name), { force: true })
}

const listManifests = (targetPath: string): string[] => {
  const dir = join(targetPath, MANIFEST_DIR)
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.slice(0, -".json".length))
}

/** True when a manifest other than `excludeId` records a change to `path`. */
const isPathSharedWithOtherManifest = (
  targetPath: string,
  path: string,
  excludeId: string
): boolean => {
  return listManifests(targetPath)
    .filter((id) => id !== excludeId)
    .some((id) => {
      const file = join(targetPath, MANIFEST_DIR, `${id}.json`)
      return readJsonFile(
        file,
        manifestSchema,
        "manifest-invalid"
      ).changes.some((change) => change.path === path)
    })
}

export type { Manifest }
export {
  deleteManifest,
  isPathSharedWithOtherManifest,
  manifestId,
  manifestPath,
  readManifest,
  writeManifest,
}
