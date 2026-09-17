/** Helpers shared by the `g` generators that take a model name and attributes. */

import { existsSync } from "node:fs"
import type { Attribute, ModelSpec } from "../../core/adapters.js"
import type { Context } from "../../core/context.js"
import { WeeError } from "../../core/errors.js"
import { manifestPath, readManifest } from "../../core/manifest.js"
import { buildModelSpec, parseAttributes } from "../../lib/attributes.js"
import { kebabCase } from "../../lib/inflect.js"

const nameArg = {
  name: {
    type: "positional",
    description: "Model name, e.g. Post",
    required: true,
  },
} as const

/** citty keeps every positional in `_`, including `name`; the rest are attributes. */
const attributeArgs = (positional: string[]): string[] => positional.slice(1)

/**
 * Attributes from the command line, or from the `g model` manifest when
 * none were given. Throws `attributes-required` when neither exists.
 */
const resolveAttributes = (
  ctx: Context,
  name: string,
  raw: string[]
): Attribute[] => {
  if (raw.length > 0) {
    return parseAttributes(raw)
  }
  const key = kebabCase(name)
  const recorded = existsSync(manifestPath(ctx.target.path, "model", key))
    ? readManifest(ctx.target.path, "model", key).manifest.args.positional
    : undefined
  if (Array.isArray(recorded) && recorded.length > 1) {
    return parseAttributes(attributeArgs(recorded.map(String)))
  }
  throw new WeeError(
    "attributes-required",
    `${name}: pass attributes (title:string ...) or run "wee g model ${name}" first`
  )
}

const resolveModel = (ctx: Context, name: string, raw: string[]): ModelSpec =>
  buildModelSpec(name, resolveAttributes(ctx, name, raw))

export { attributeArgs, nameArg, resolveAttributes, resolveModel }
