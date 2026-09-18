/**
 * `wee g model <Name> [attr:type[:modifier]...]`: model file, schema index
 * export, validator + test, service and the create-table migration.
 */
import { getDbAdapter } from "../../adapters/index.js"
import type { ModelSpec } from "../../core/adapters.js"
import type { FileChange } from "../../core/changes.js"
import { defineWeeCommand } from "../../core/command.js"
import type { Context } from "../../core/context.js"
import { assertAppRouter } from "../../core/context.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { buildModelSpec, parseAttributes } from "../../lib/attributes.js"
import { attributeArgs, nameArg } from "./shared.js"

interface ModelChangesOptions {
  model: ModelSpec
  skipMigration: boolean
}

/** Changes for one model: schema, validator, service and optional migration. */
const modelChanges = async (
  ctx: Context,
  options: ModelChangesOptions
): Promise<FileChange[]> => {
  const { model, skipMigration } = options
  const adapter = getDbAdapter(ctx)
  const schemaChanges = adapter.emitModel(ctx, model)
  const changes = [
    ...schemaChanges,
    ...adapter.emitValidator(ctx, model),
    ...adapter.emitService(ctx, model),
  ]
  if (skipMigration) {
    return changes
  }
  const migration = await adapter.emitMigration(ctx, {
    name: `create_${model.table}`,
    change: { kind: "create-table", model },
    pending: schemaChanges,
  })
  return [...changes, ...migration]
}

const modelGenerator = defineGenerator({
  name: "model",
  description: "Model, validator, service and migration",
  args: {
    ...nameArg,
    "skip-migration": {
      type: "boolean",
      description: "Do not write a migration",
      default: false,
    },
  },
  manifestName: (args) => buildModelSpec(args.name, []).name,
  run: (ctx, args) => {
    assertAppRouter(ctx)
    return modelChanges(ctx, {
      model: buildModelSpec(args.name, parseAttributes(attributeArgs(args._))),
      skipMigration: args["skip-migration"],
    })
  },
})

const model = defineWeeCommand({
  meta: { name: "model", description: modelGenerator.description },
  args: modelGenerator.args,
  run: (ctx, args) => runGenerator({ ctx, generator: modelGenerator, args }),
})

export { model, modelChanges, modelGenerator }
