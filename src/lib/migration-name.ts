/**
 * Rails-style migration names. `AddStatusToPosts` adds columns to `posts`,
 * `RemoveStatusFromPosts` removes them, anything else is a custom
 * migration with an empty SQL body. `Create*` is refused: `g model` owns it.
 */
import { WeeError } from "../core/errors.js"
import { snakeCase } from "./inflect.js"

type MigrationIntent =
  | { kind: "add"; table: string }
  | { kind: "remove"; table: string }
  | { kind: "custom" }

interface ParsedMigrationName {
  /** snake_case name passed to the migration tool. */
  name: string
  intent: MigrationIntent
}

const parseMigrationName = (raw: string): ParsedMigrationName => {
  const name = snakeCase(raw)
  const add = raw.match(/^Add\w+To([A-Z]\w*)$/)
  if (add?.[1] !== undefined) {
    return { name, intent: { kind: "add", table: snakeCase(add[1]) } }
  }
  const remove = raw.match(/^Remove\w+From([A-Z]\w*)$/)
  if (remove?.[1] !== undefined) {
    return { name, intent: { kind: "remove", table: snakeCase(remove[1]) } }
  }
  if (/^Create[A-Z]/.test(raw)) {
    throw new WeeError(
      "use-model-generator",
      `${raw}: tables are created with "wee g model <Name> <attributes>"`
    )
  }
  return { name, intent: { kind: "custom" } }
}

export type { MigrationIntent, ParsedMigrationName }
export { parseMigrationName }
