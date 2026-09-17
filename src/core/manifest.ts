/**
 * Manifests record what a generator run wrote so `destroy` can reverse it.
 * One JSON file per run under `<app>/.app/manifests/<generator>-<name>.json`.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
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
  const manifest: Manifest = {
    generator,
    name,
    createdAt: new Date().toISOString(),
    cliVersion,
    args,
    changes,
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
  const result = manifestSchema.safeParse(
    JSON.parse(readFileSync(file, "utf8"))
  )
  if (!result.success) {
    throw new WeeError(
      "manifest-invalid",
      `Invalid manifest ${file}: ${z.prettifyError(result.error)}`
    )
  }
  return { path: file, manifest: result.data }
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

export type { Manifest }
export {
  deleteManifest,
  listManifests,
  MANIFEST_DIR,
  manifestId,
  manifestPath,
  readManifest,
  writeManifest,
}
