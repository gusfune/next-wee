/** `wee g <generator>` namespace. Each generator loads lazily. */
import { defineCommand } from "citty"

const g = defineCommand({
  meta: { name: "g", description: "Generate a primitive (alias: generate)" },
  subCommands: {
    model: () => import("./model.js").then((m) => m.model),
    migration: () => import("./migration.js").then((m) => m.migration),
    validator: () => import("./validator.js").then((m) => m.validator),
    service: () => import("./service.js").then((m) => m.service),
  },
})

export { g }
