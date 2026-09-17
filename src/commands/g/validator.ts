/** `wee g validator <Name> [attrs...]`: Zod schemas and their Vitest test. */
import { getDbAdapter } from "../../adapters/index.js"
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { buildModelSpec } from "../../lib/attributes.js"
import { attributeArgs, nameArg, resolveModel } from "./shared.js"

const validatorGenerator = defineGenerator({
  name: "validator",
  description: "Zod insert/update/query schemas with a test",
  args: nameArg,
  manifestName: (args) => buildModelSpec(args.name, []).name,
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const model = resolveModel(ctx, args.name, attributeArgs(args._))
    return getDbAdapter(ctx).emitValidator(ctx, model)
  },
})

const validator = defineWeeCommand({
  meta: { name: "validator", description: validatorGenerator.description },
  args: validatorGenerator.args,
  run: (ctx, args) =>
    runGenerator({ ctx, generator: validatorGenerator, args }),
})

export { validator, validatorGenerator }
