/**
 * `wee g action <segment> <name...> [attrs...]`: server actions in
 * `app/<segment>/actions.ts`. `create`, `update` and `remove` are bound to
 * the segment's model (validator + service); any other name is a generic
 * action called `<name><Model>`, e.g. `publishPost`. One manifest per run,
 * named `<segment>-<names>`.
 */
import type { FileChange } from "../../core/changes.js"
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { WeeError } from "../../core/errors.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { camelCase, kebabCase, plural } from "../../lib/inflect.js"
import type { Segment } from "../../lib/segment.js"
import { parseSegment } from "../../lib/segment.js"
import {
  actionsLibTemplate,
  actionsTemplate,
  createActionBlock,
  genericActionBlock,
  removeActionBlock,
  updateActionBlock,
} from "../../templates/app.js"
import {
  assertBlockAbsent,
  exists,
  relativeImport,
  segmentDir,
  srcPath,
} from "./paths.js"
import { resolveModel, segmentArg, splitPositionals } from "./shared.js"

const MODEL_ACTIONS = ["create", "update", "remove"] as const
type ModelAction = (typeof MODEL_ACTIONS)[number]

const isModelAction = (name: string): name is ModelAction =>
  (MODEL_ACTIONS as readonly string[]).includes(name)

const actionNames = (positional: string[]): string[] => {
  const { words } = splitPositionals(positional)
  const names = [...new Set(words.map(camelCase))]
  if (names.length === 0) {
    throw new WeeError(
      "names-required",
      "Pass at least one action name, e.g. create update remove or publish"
    )
  }
  return names
}

const manifestName = (segment: Segment, names: string[]): string =>
  `${segment.key}-${names.map(kebabCase).join("-")}`

interface BlockOptions {
  segment: Segment
  name: string
  actionsFile: string
}

const actionGenerator = defineGenerator({
  name: "action",
  description: "Server actions for a segment",
  args: segmentArg,
  manifestName: (args) =>
    manifestName(parseSegment(args.segment), actionNames(args._)),
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const segment = parseSegment(args.segment)
    const names = actionNames(args._)
    const actionsFile = `${segmentDir(ctx, segment)}/actions.ts`
    const libFile = srcPath(ctx, "lib", "actions.ts")
    const changes: FileChange[] = [
      { kind: "ensure", path: libFile, content: actionsLibTemplate() },
      {
        kind: "ensure",
        path: actionsFile,
        content: actionsTemplate({
          segment,
          libImport: relativeImport(actionsFile, libFile),
        }),
      },
    ]
    const modelBlock = names.some(isModelAction)
      ? modelBlockFactory(ctx, {
          segment,
          actionsFile,
          attributes: splitPositionals(args._).attributes,
        })
      : undefined
    for (const name of names) {
      const options: BlockOptions = { segment, name, actionsFile }
      const { fn, content } =
        modelBlock !== undefined && isModelAction(name)
          ? modelBlock(name)
          : genericBlock(options)
      const marker = `action-${kebabCase(fn)}`
      assertBlockAbsent(ctx, actionsFile, marker)
      changes.push({ kind: "inject", path: actionsFile, marker, content })
    }
    return changes
  },
})

interface ModelBlockFactoryOptions {
  segment: Segment
  actionsFile: string
  attributes: string[]
}

interface Block {
  fn: string
  content: string
}

/** Resolves the model once and returns a builder for its create/update/remove blocks. */
const modelBlockFactory = (
  ctx: Parameters<typeof resolveModel>[0],
  options: ModelBlockFactoryOptions
): ((name: ModelAction) => Block) => {
  const { segment, actionsFile, attributes } = options
  const model = resolveModel(ctx, segment.modelName, attributes)
  const validatorFile = srcPath(
    ctx,
    "lib",
    "validators",
    `${kebabCase(model.name)}.ts`
  )
  const serviceFile = srcPath(
    ctx,
    "services",
    `${kebabCase(plural(model.name))}.ts`
  )
  const missing = [validatorFile, serviceFile].filter(
    (file) => !exists(ctx, file)
  )
  if (missing.length > 0) {
    throw new WeeError(
      "model-files-missing",
      `${missing.join(", ")} missing. Run "wee g model ${model.name}" first.`
    )
  }
  const blockOptions = {
    segment,
    model,
    validatorImport: relativeImport(actionsFile, validatorFile),
    serviceImport: relativeImport(actionsFile, serviceFile),
  }
  return (name) => {
    switch (name) {
      case "create":
        return {
          fn: `create${model.name}`,
          content: createActionBlock(blockOptions),
        }
      case "update":
        return {
          fn: `update${model.name}`,
          content: updateActionBlock(blockOptions),
        }
      case "remove":
        return {
          fn: `remove${model.name}`,
          content: removeActionBlock(blockOptions),
        }
    }
  }
}

const genericBlock = (options: BlockOptions): Block => {
  const { segment, name } = options
  const fn = `${camelCase(name)}${segment.modelName}`
  return { fn, content: genericActionBlock({ segment, name: fn }) }
}

const action = defineWeeCommand({
  meta: { name: "action", description: actionGenerator.description },
  args: actionGenerator.args,
  run: (ctx, args) => runGenerator({ ctx, generator: actionGenerator, args }),
})

export { action, actionGenerator }
