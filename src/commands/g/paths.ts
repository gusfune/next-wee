/**
 * Path helpers shared by the route and UI generators: source-relative
 * locations, relative import specifiers and the shared-package retarget
 * used by `g helper --shared`.
 */
import { existsSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import type { FileChange } from "../../core/changes.js"
import { createOrReplace, readIfExists } from "../../core/changes.js"
import { loadConfig } from "../../core/config.js"
import type { Context } from "../../core/context.js"
import { sourceDir } from "../../core/context.js"
import { WeeError } from "../../core/errors.js"
import { hasBlock } from "../../core/inject.js"
import { kebabCase } from "../../lib/inflect.js"
import type { Segment } from "../../lib/segment.js"

/** Path under the source root, e.g. `src/components/posts/post-card.tsx`. */
const srcPath = (ctx: Context, ...parts: string[]): string =>
  join(sourceDir(ctx), ...parts)

/** Directory of a segment, e.g. `src/app/posts/[id]`. */
const segmentDir = (ctx: Context, segment: Segment): string =>
  srcPath(ctx, "app", segment.dir)

/** Import specifier from `fromFile` to `toFile` (both target-relative), without extension. */
const relativeImport = (fromFile: string, toFile: string): string => {
  const spec = relative(dirname(fromFile), toFile).replace(/\.tsx?$/, "")
  return spec.startsWith(".") ? spec : `./${spec}`
}

const create = (ctx: Context, path: string, content: string): FileChange =>
  createOrReplace({
    root: ctx.target.path,
    force: ctx.flags.force,
    path,
    content,
  })

/** Throws `block-exists` when the marker is already in the file, unless `--force`. */
const assertBlockAbsent = (
  ctx: Context,
  path: string,
  marker: string
): void => {
  const source = readIfExists(join(ctx.target.path, path))
  if (
    source !== undefined &&
    hasBlock(source, path, marker) &&
    !ctx.flags.force
  ) {
    throw new WeeError(
      "block-exists",
      `${path} already has the block "${marker}". Pass --force to replace it.`
    )
  }
}

const exists = (ctx: Context, path: string): boolean =>
  existsSync(join(ctx.target.path, path))

/**
 * Context for the shared package: the current target when it is a package,
 * else the only non-app workspace. Fails with the candidates otherwise.
 */
const retargetToPackage = (ctx: Context): Context => {
  if (ctx.target.kind === "package") {
    return ctx
  }
  const packages = ctx.repo.workspaces.filter(
    (workspace) => !workspace.isNextApp
  )
  const candidates = packages.map((workspace) => workspace.name)
  const only = packages[0]
  if (packages.length !== 1 || only === undefined) {
    throw new WeeError(
      "shared-package-required",
      packages.length === 0
        ? "No shared package in this repo. --shared needs a workspace without next."
        : `Several shared packages. Pass --package <name>. Candidates: ${candidates.join(", ")}`,
      { data: { candidates } }
    )
  }
  const target = { name: only.name, path: only.path, kind: "package" as const }
  return {
    ...ctx,
    target,
    ...loadConfig({ repoRoot: ctx.repo.root, targetPath: only.path }),
  }
}

/** File name for a PascalCase name, e.g. `PostCard` to `post-card`. */
const fileName = (name: string): string => kebabCase(name)

export {
  assertBlockAbsent,
  create,
  exists,
  fileName,
  relativeImport,
  retargetToPackage,
  segmentDir,
  srcPath,
}
