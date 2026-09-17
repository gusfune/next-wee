/**
 * `wee g migration <Name> [attrs...]`. Rails-style names drive the intent:
 * `AddTitleToPosts` edits the model and adds columns, `RemoveTitleFromPosts`
 * drops them, anything else writes a custom (empty) migration.
 */
import { getDbAdapter } from "../../adapters/index.js"
import type { SchemaChange } from "../../core/adapters.js"
import { defineWeeCommand } from "../../core/command.js"
import { assertAppRouter } from "../../core/context.js"
import { WeeError } from "../../core/errors.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { parseAttributes } from "../../lib/attributes.js"
import { parseMigrationName } from "../../lib/migration-name.js"
import { attributeArgs, nameArg } from "./shared.js"

const migrationGenerator = defineGenerator({
  name: "migration",
  description:
    "Migration from a Rails-style name (AddXToY, RemoveXFromY, or custom)",
  args: nameArg,
  manifestName: (args) => parseMigrationName(args.name).name,
  run: async (ctx, args) => {
    assertAppRouter(ctx)
    const adapter = getDbAdapter(ctx)
    const { name, intent } = parseMigrationName(args.name)
    const attributes = parseAttributes(attributeArgs(args._))
    const change = ((): SchemaChange => {
      if (intent.kind === "custom") {
        return { kind: "custom" }
      }
      if (attributes.length === 0) {
        throw new WeeError(
          "attributes-required",
          `${args.name}: list the columns, e.g. title:string. Remove needs the full definition for the down migration.`
        )
      }
      return intent.kind === "add"
        ? { kind: "add-columns", table: intent.table, attributes }
        : { kind: "remove-columns", table: intent.table, attributes }
    })()
    return adapter.emitMigration(ctx, { name, change, pending: [] })
  },
})

const migration = defineWeeCommand({
  meta: { name: "migration", description: migrationGenerator.description },
  args: migrationGenerator.args,
  run: (ctx, args) =>
    runGenerator({ ctx, generator: migrationGenerator, args }),
})

export { migration, migrationGenerator }
