/**
 * `wee g form <Model> [attrs...]`: a client form bound to the model's
 * `create` and `update` server actions through `useActionState`. Needs the
 * model file and `app/<plural>/actions.ts` with both actions.
 */
import { join } from "node:path"
import { readIfExists } from "../../core/changes.js"
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { WeeError } from "../../core/errors.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { buildModelSpec } from "../../lib/attributes.js"
import { kebabCase, plural } from "../../lib/inflect.js"
import { actionsLibTemplate } from "../../templates/app.js"
import { formTemplate, formTestTemplate } from "../../templates/ui.js"
import { create, exists, relativeImport, srcPath } from "./paths.js"
import { attributeArgs, nameArg, resolveModel } from "./shared.js"

const formGenerator = defineGenerator({
  name: "form",
  description: "Client form bound to the model's create and update actions",
  args: nameArg,
  manifestName: (args) => buildModelSpec(args.name, []).name,
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const model = resolveModel(ctx, args.name, attributeArgs(args._))
    const area = kebabCase(plural(model.name))
    const modelFile = srcPath(
      ctx,
      ctx.config.db?.schemaDir ?? "db/schema",
      `${kebabCase(model.table)}.ts`
    )
    if (!exists(ctx, modelFile)) {
      throw new WeeError(
        "model-missing",
        `${modelFile} does not exist. Run "wee g model ${model.name}" first.`
      )
    }
    const actionsFile = srcPath(ctx, "app", area, "actions.ts")
    const actions = readIfExists(join(ctx.target.path, actionsFile)) ?? ""
    const needed = [`create${model.name}`, `update${model.name}`]
    if (!needed.every((name) => actions.includes(`export const ${name} `))) {
      throw new WeeError(
        "actions-missing",
        `${actionsFile} needs ${needed.join(" and ")}. Run "wee g action ${area} create update" first.`
      )
    }
    const dir = srcPath(ctx, "components", area)
    const file = join(dir, `${kebabCase(model.name)}-form.tsx`)
    const options = {
      model,
      modelImport: relativeImport(file, modelFile),
      actionsImport: relativeImport(file, actionsFile),
      libImport: relativeImport(file, srcPath(ctx, "lib", "actions.ts")),
    }
    return [
      {
        kind: "ensure",
        path: srcPath(ctx, "lib", "actions.ts"),
        content: actionsLibTemplate(),
      },
      create(ctx, file, formTemplate(options)),
      create(
        ctx,
        join(dir, `${kebabCase(model.name)}-form.test.tsx`),
        formTestTemplate(options)
      ),
    ]
  },
})

const form = defineWeeCommand({
  meta: { name: "form", description: formGenerator.description },
  args: formGenerator.args,
  run: (ctx, args) => runGenerator({ ctx, generator: formGenerator, args }),
})

export { form, formGenerator }
