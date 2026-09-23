/**
 * Wrapper over citty `defineCommand`. Adds the global flags to every
 * command, builds the Context before the body runs, renders the result and
 * maps errors to exit codes.
 */

import type { ArgsDef, CommandDef, CommandMeta, ParsedArgs } from "citty"
import { defineCommand } from "citty"
import type { Context, GlobalFlags } from "./context.js"
import { buildContext } from "./context.js"
import type { Row } from "./output.js"
import { emit, reportError } from "./output.js"

const globalArgs = {
  "dry-run": {
    type: "boolean",
    description: "Print the plan, write nothing",
    default: false,
  },
  json: {
    type: "boolean",
    description: "Machine-readable output",
    default: false,
  },
  force: { type: "boolean", description: "Skip safety checks", default: false },
  app: {
    type: "string",
    description: "Target workspace by package name (monorepo)",
  },
  package: {
    type: "string",
    description: "Target a shared package by name (monorepo)",
  },
} as const satisfies ArgsDef

type GlobalArgs = typeof globalArgs

type CommandArgs<T extends ArgsDef> = ParsedArgs<T & GlobalArgs>

interface CommandResult {
  data: Row[] | Row
  title?: string
}

interface WeeCommandDef<T extends ArgsDef> {
  meta: CommandMeta
  args?: T
  /**
   * The command honours `--dry-run` itself or has no side effects. Without
   * it, `--dry-run` reports a skip and the body never runs, so a new command
   * cannot drop a database by forgetting to read the flag.
   */
  dryRun?: true
  run: (
    ctx: Context,
    args: CommandArgs<T>,
    /** The tokens after the command name, for commands that forward them. */
    rawArgs: string[]
  ) => Promise<CommandResult | undefined>
}

const readGlobalFlags = (args: ParsedArgs<GlobalArgs>): GlobalFlags => ({
  dryRun: args["dry-run"],
  json: args.json,
  force: args.force,
  app: args.app,
  pkg: args.package,
})

const defineWeeCommand = <T extends ArgsDef>(
  def: WeeCommandDef<T>
): CommandDef<T & GlobalArgs> => {
  const args = { ...(def.args ?? ({} as T)), ...globalArgs } as T & GlobalArgs
  return defineCommand<T & GlobalArgs>({
    meta: def.meta,
    args,
    run: async ({ args: parsed, rawArgs }) => {
      const flags = readGlobalFlags(parsed)
      try {
        const ctx = await buildContext({ cwd: process.cwd(), flags })
        if (flags.dryRun && def.dryRun !== true) {
          emit({
            json: flags.json,
            data: { action: "skip", path: def.meta.name ?? "" },
            title: `dry-run: ${def.meta.name ?? ""} has side effects; nothing ran`,
          })
          return
        }
        const result = await def.run(ctx, parsed, rawArgs)
        if (result !== undefined) {
          emit({
            json: flags.json,
            data: result.data,
            ...(result.title === undefined ? {} : { title: result.title }),
          })
        }
      } catch (error) {
        process.exitCode = reportError(error, flags.json)
      }
    },
  })
}

export type { CommandArgs, CommandResult }
export { defineWeeCommand, globalArgs }
