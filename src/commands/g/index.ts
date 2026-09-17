/**
 * `wee g <generator>` namespace. Each generator registers here as a lazy
 * subcommand. Phase 1 adds model, migration, validator and service.
 */
import { defineCommand } from "citty"

const g = defineCommand({
  meta: { name: "g", description: "Generate a primitive (alias: generate)" },
  subCommands: {},
})

export { g }
