/**
 * `wee g form <Model> [attrs...]`: a client form bound to the model's
 * `create` and `update` server actions through `useActionState`. Needs the
 * model file and `app/<plural>/actions.ts` with both actions.
 */
import { join } from "node:path"
import { getDbAdapter } from "../../adapters/index.js"
import type { ModelSpec } from "../../core/adapters.js"
import type { FileChange } from "../../core/changes.js"
import { readIfExists } from "../../core/changes.js"
import { defineWeeCommand } from "../../core/command.js"
import type { Context } from "../../core/context.js"
import { assertAppRouter } from "../../core/context.js"
import { WeeError } from "../../core/errors.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { buildModelSpec } from "../../lib/attributes.js"
import { kebabCase, plural } from "../../lib/inflect.js"
import { actionsLibTemplate } from "../../templates/app.js"
import { formTemplate, formTestTemplate } from "../../templates/ui.js"
import { create, existsOrPending, relativeImport, srcPath } from "./paths.js"
import { attributeArgs, nameArg, resolveModel } from "./shared.js"

/** Path of the model's form component, e.g. `src/components/posts/post-form.tsx`. */
const formPath = (ctx: Context, model: ModelSpec): string =>
  srcPath(
    ctx,
    "components",
    kebabCase(plural(model.name)),
    `${kebabCase(model.name)}-form.tsx`
  )

/** True when the actions file on disk or a pending inject exports `<fn>`. */
const hasAction = (
  ctx: Context,
  actionsFile: string,
  fn: string,
  pending: readonly FileChange[]
): boolean => {
  const source = readIfExists(join(ctx.target.path, actionsFile)) ?? ""
  return (
    source.includes(`export const ${fn} `) ||
    pending.some(
      (change) =>
        change.kind === "inject" &&
        change.path === actionsFile &&
        change.marker === `action-${kebabCase(fn)}`
    )
  )
}

interface FormChangesOptions {
  model: ModelSpec
  /** Changes queued by an enclosing generator, e.g. `g resource`. */
  pending?: readonly FileChange[] | undefined
}

/** Changes for the model's form: lib, component and its test. */
const formChanges = (
  ctx: Context,
  options: FormChangesOptions
): FileChange[] => {
  const { model, pending = [] } = options
  const area = kebabCase(plural(model.name))
  const adapter = getDbAdapter(ctx)
  const modelFile = adapter.modelPath(ctx, model)
  if (!existsOrPending(ctx, modelFile, pending)) {
    throw new WeeError(
      "model-missing",
      `${modelFile} does not exist. Run "wee g model ${model.name}" first.`
    )
  }
  const actionsFile = srcPath(ctx, "app", area, "actions.ts")
  const needed = [`create${model.name}`, `update${model.name}`]
  if (!needed.every((fn) => hasAction(ctx, actionsFile, fn, pending))) {
    throw new WeeError(
      "actions-missing",
      `${actionsFile} needs ${needed.join(" and ")}. Run "wee g action ${area} create update" first.`
    )
  }
  const file = formPath(ctx, model)
  const templateOptions = {
    model,
    modelImport: relativeImport(file, adapter.modelTypeImport(ctx, model)),
    actionsImport: relativeImport(file, actionsFile),
    libImport: relativeImport(file, srcPath(ctx, "lib", "actions.ts")),
  }
  return [
    {
      kind: "ensure",
      path: srcPath(ctx, "lib", "actions.ts"),
      content: actionsLibTemplate(),
    },
    create(ctx, file, formTemplate(templateOptions)),
    create(
      ctx,
      file.replace(/\.tsx$/, ".test.tsx"),
      formTestTemplate(templateOptions)
    ),
  ]
}

const formGenerator = defineGenerator({
  name: "form",
  description: "Client form bound to the model's create and update actions",
  args: nameArg,
  manifestName: (args) => buildModelSpec(args.name, []).name,
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const model = resolveModel(ctx, args.name, attributeArgs(args._))
    return formChanges(ctx, { model })
  },
})

const form = defineWeeCommand({
  meta: { name: "form", description: formGenerator.description },
  args: formGenerator.args,
  run: (ctx, args) => runGenerator({ ctx, generator: formGenerator, args }),
})

export { form, formChanges, formGenerator, formPath }
