/**
 * `wee destroy <generator> <Name>`: reverses a generator run from its
 * manifest. Refuses when a generated file changed since generation unless
 * `--force`. Changes are reversed in reverse order.
 */
import { existsSync, readdirSync, rmdirSync, rmSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import type { AppliedChange } from "../core/changes.js"
import { readIfExists, sha256, writeFile } from "../core/changes.js"
import { defineWeeCommand } from "../core/command.js"
import type { Context } from "../core/context.js"
import { WeeError } from "../core/errors.js"
import { hasBlock, readBlock, removeBlock } from "../core/inject.js"
import { deleteManifest, readManifest } from "../core/manifest.js"

interface DriftCheck {
  path: string
  reason: string
}

const checkDrift = (
  root: string,
  change: AppliedChange
): DriftCheck | undefined => {
  const file = join(root, change.path)
  const current = readIfExists(file)
  if (change.kind === "delete") {
    return undefined
  }
  if (current === undefined) {
    return { path: change.path, reason: "missing" }
  }
  if (change.kind === "inject") {
    if (
      change.marker === undefined ||
      !hasBlock(current, change.path, change.marker)
    ) {
      return { path: change.path, reason: "injected block missing" }
    }
    return undefined
  }
  if (change.hash !== undefined && sha256(current) !== change.hash) {
    return { path: change.path, reason: "modified since generation" }
  }
  return undefined
}

/** Removes now-empty parent directories up to (excluding) the root. */
const pruneEmptyDirs = (root: string, file: string): void => {
  let dir = dirname(file)
  while (
    dir !== root &&
    dir.startsWith(root) &&
    existsSync(dir) &&
    readdirSync(dir).length === 0
  ) {
    rmdirSync(dir)
    dir = dirname(dir)
  }
}

const reverseChange = (ctx: Context, change: AppliedChange): string => {
  const root = ctx.target.path
  const file = join(root, change.path)
  switch (change.kind) {
    case "create": {
      if (!ctx.flags.dryRun) {
        rmSync(file, { force: true })
        pruneEmptyDirs(root, file)
      }
      return "delete"
    }
    case "modify": {
      if (change.previous === undefined) {
        throw new WeeError(
          "manifest-invalid",
          `${change.path}: no previous content recorded`
        )
      }
      if (!ctx.flags.dryRun) {
        writeFile(file, change.previous)
      }
      return "restore"
    }
    case "inject": {
      const current = readIfExists(file)
      if (current === undefined || change.marker === undefined) {
        return "skip"
      }
      const next = removeBlock(current, change.path, change.marker)
      if (!ctx.flags.dryRun) {
        if (
          next.trim().length === 0 &&
          readBlock(current, change.path, change.marker) !== undefined
        ) {
          rmSync(file)
          pruneEmptyDirs(root, file)
          return "delete"
        }
        writeFile(file, next)
      }
      return `remove:${change.marker}`
    }
    case "delete": {
      return "skip"
    }
  }
}

const destroy = defineWeeCommand({
  meta: {
    name: "destroy",
    description: "Reverse a generator run from its manifest",
  },
  args: {
    generator: {
      type: "positional",
      description: "Generator name, e.g. model",
      required: true,
    },
    name: {
      type: "positional",
      description: "Name given to the generator, e.g. Post",
      required: true,
    },
  },
  run: async (ctx, args) => {
    const { manifest, path } = readManifest(
      ctx.target.path,
      args.generator,
      args.name
    )
    const drift = manifest.changes
      .map((change) => checkDrift(ctx.target.path, change))
      .filter((check): check is DriftCheck => check !== undefined)
    if (drift.length > 0 && !ctx.flags.force) {
      throw new WeeError(
        "drift",
        "Generated files changed since generation. Pass --force to destroy anyway.",
        {
          data: { drift },
        }
      )
    }
    const rows = [...manifest.changes].reverse().map((change) => ({
      action: reverseChange(ctx, change),
      path: change.path,
    }))
    if (!ctx.flags.dryRun) {
      deleteManifest(ctx.target.path, args.generator, args.name)
      pruneEmptyDirs(ctx.target.path, path)
    }
    rows.push({ action: "delete", path: relative(ctx.target.path, path) })
    return {
      title: `${ctx.flags.dryRun ? "dry-run: " : ""}destroy ${manifest.generator} ${manifest.name}`,
      data: rows,
    }
  },
})

export { destroy }
