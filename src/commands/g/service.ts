/** `wee g service <Name> [attrs...]`: typed CRUD over the model's table. */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { getDbAdapter } from "../../adapters/index.js"
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { WeeError } from "../../core/errors.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { buildModelSpec } from "../../lib/attributes.js"
import { attributeArgs, nameArg, resolveModel } from "./shared.js"

const serviceGenerator = defineGenerator({
  name: "service",
  description: "CRUD service for a model",
  args: nameArg,
  manifestName: (args) => buildModelSpec(args.name, []).name,
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const model = resolveModel(ctx, args.name, attributeArgs(args._))
    const adapter = getDbAdapter(ctx)
    const modelPath = adapter.modelPath(ctx, model)
    if (!existsSync(join(ctx.target.path, modelPath))) {
      throw new WeeError(
        "model-missing",
        `${model.name}: no model at ${modelPath}. Run "wee g model" first.`
      )
    }
    return adapter.emitService(ctx, model)
  },
})

const service = defineWeeCommand({
  meta: { name: "service", description: serviceGenerator.description },
  args: serviceGenerator.args,
  run: (ctx, args) => runGenerator({ ctx, generator: serviceGenerator, args }),
})

export { service, serviceGenerator }
