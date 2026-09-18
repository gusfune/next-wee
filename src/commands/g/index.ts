/**
 * `wee g <generator>` namespace. Built-in generators load lazily. Custom
 * generators from the target's `tools/generators/<name>/index.ts` join the
 * map under their directory name; a built-in name wins on a clash.
 */
import type { CommandDef, SubCommandsDef } from "citty"
import { defineCommand } from "citty"
import { customGeneratorLoaders } from "../../lib/custom.js"

const builtInGenerators = {
  model: () => import("./model.js").then((m) => m.model),
  migration: () => import("./migration.js").then((m) => m.migration),
  validator: () => import("./validator.js").then((m) => m.validator),
  service: () => import("./service.js").then((m) => m.service),
  page: () => import("./page.js").then((m) => m.page),
  layout: () => import("./layout.js").then((m) => m.layout),
  handler: () => import("./handler.js").then((m) => m.handler),
  metadata: () => import("./metadata.js").then((m) => m.metadata),
  component: () => import("./component.js").then((m) => m.component),
  form: () => import("./form.js").then((m) => m.form),
  hook: () => import("./hook.js").then((m) => m.hook),
  helper: () => import("./helper.js").then((m) => m.helper),
  provider: () => import("./provider.js").then((m) => m.provider),
  type: () => import("./type.js").then((m) => m.type),
  env: () => import("./env.js").then((m) => m.env),
  proxy: () => import("./proxy.js").then((m) => m.proxy),
  action: () => import("./action.js").then((m) => m.action),
  resource: () => import("./resource.js").then((m) => m.resource),
  auth: () => import("./auth.js").then((m) => m.auth),
  "auth:provider": () =>
    import("./auth-provider.js").then((m) => m.authProvider),
  job: () => import("./job.js").then((m) => m.job),
  email: () => import("./email.js").then((m) => m.email),
  generator: () => import("./generator.js").then((m) => m.generator),
  task: () => import("./task.js").then((m) => m.task),
} satisfies SubCommandsDef

const g = async (): Promise<CommandDef> =>
  defineCommand({
    meta: { name: "g", description: "Generate a primitive (alias: generate)" },
    subCommands: { ...(await customGeneratorLoaders()), ...builtInGenerators },
  })

export { builtInGenerators, g }
