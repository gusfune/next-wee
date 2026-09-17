/**
 * `wee g model <Name> [attr:type[:modifier]...]`: model file, schema index
 * export, validator + test, service and the create-table migration.
 */
import { getDbAdapter } from "../../adapters/index.js"
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { buildModelSpec, parseAttributes } from "../../lib/attributes.js"
import { attributeArgs, nameArg } from "./shared.js"

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
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const adapter = getDbAdapter(ctx)
    const model = buildModelSpec(
      args.name,
      parseAttributes(attributeArgs(args._))
    )
    const modelChanges = adapter.emitModel(ctx, model)
    const changes = [
      ...modelChanges,
      ...adapter.emitValidator(ctx, model),
      ...adapter.emitService(ctx, model),
    ]
    if (args["skip-migration"]) {
      return changes
    }
    const migration = await adapter.emitMigration(ctx, {
      name: `create_${model.table}`,
      change: { kind: "create-table", model },
      pending: modelChanges,
    })
    return [...changes, ...migration]
  },
})

const model = defineWeeCommand({
  meta: { name: "model", description: modelGenerator.description },
  args: modelGenerator.args,
  run: (ctx, args) => runGenerator({ ctx, generator: modelGenerator, args }),
})

export { model, modelGenerator }
