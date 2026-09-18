/** `wee g <generator>` namespace. Each generator loads lazily. */
import { defineCommand } from "citty"

const g = defineCommand({
  meta: { name: "g", description: "Generate a primitive (alias: generate)" },
  subCommands: {
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
  },
})

export { g }
