/**
 * Commands built at run time for app-defined extensions. A custom generator
 * runs in a child process inside the target (its module may import app
 * code); it sends back the FileChange list and the CLI applies it, so the
 * global flags and `destroy` work unchanged. A task runs through the
 * console preload in runner mode.
 */
import { z } from "zod"
import { fileChangeSchema } from "../core/changes.js"
import type { CommandResult } from "../core/command.js"
import { defineWeeCommand } from "../core/command.js"
import type { Context } from "../core/context.js"
import { WeeError } from "../core/errors.js"
import { recordGeneratorRun } from "../core/generator.js"
import { runScript } from "../lib/packages.js"
import { runtimeScript } from "../lib/runtime.js"
import type { GeneratorInput } from "../runtime/protocol.js"
import { GENERATOR_RESULT_MARKER } from "../runtime/protocol.js"
import { runPreload } from "./console.js"

interface ExtensionCommand {
  name: string
  /** Absolute path of the module. */
  file: string
  description: string
}

const generatorResultSchema = z.object({
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
  changes: z.array(fileChangeSchema),
})

interface RunCustomGeneratorOptions {
  ctx: Context
  generator: ExtensionCommand
  rawArgs: string[]
}

const runCustomGenerator = async (
  options: RunCustomGeneratorOptions
): Promise<CommandResult> => {
  const { ctx, generator, rawArgs } = options
  const input: GeneratorInput = { ctx, rawArgs }
  const result = await runScript({
    ctx,
    script: runtimeScript("generator"),
    args: [generator.file, JSON.stringify(input)],
    stdio: "pipe",
  })
  const lines = result.stdout.split("\n")
  const marked = lines.find((line) => line.startsWith(GENERATOR_RESULT_MARKER))
  // The generator's own prints must not corrupt `--json` output.
  const forwarded = lines
    .filter((line) => line !== marked && line.length > 0)
    .map((line) => `${line}\n`)
    .join("")
  process.stderr.write(`${forwarded}${result.stderr}`)
  if (result.exitCode !== 0 || marked === undefined) {
    throw new WeeError(
      "generator-failed",
      `${generator.name} exited with ${result.exitCode} without a result.`,
      { exitCode: result.exitCode === 0 ? 1 : result.exitCode }
    )
  }
  const parsed = generatorResultSchema.safeParse(
    JSON.parse(marked.slice(GENERATOR_RESULT_MARKER.length))
  )
  if (!parsed.success) {
    throw new WeeError(
      "generator-invalid",
      `${generator.name} returned changes that are not FileChange objects: ${z.prettifyError(parsed.error)}`
    )
  }
  return recordGeneratorRun({
    ctx,
    generator: generator.name,
    name: parsed.data.name,
    args: parsed.data.args,
    changes: parsed.data.changes,
  })
}

const customGeneratorCommand = (generator: ExtensionCommand) =>
  defineWeeCommand({
    meta: { name: generator.name, description: generator.description },
    // The generator's own args live in the child; the parent forwards them raw.
    run: (ctx, _args, rawArgs) =>
      runCustomGenerator({ ctx, generator, rawArgs }),
  })

const GLOBAL_FLAGS = new Set(["--json", "--dry-run", "--force"])
const GLOBAL_VALUE_FLAGS = new Set(["--app", "--package"])

/** The task's own args: everything the CLI did not consume. */
const stripGlobalFlags = (rawArgs: string[]): string[] => {
  const kept: string[] = []
  let skipValue = false
  for (const token of rawArgs) {
    if (skipValue) {
      skipValue = false
      continue
    }
    if (GLOBAL_FLAGS.has(token)) {
      continue
    }
    if (GLOBAL_VALUE_FLAGS.has(token)) {
      skipValue = true
      continue
    }
    if ([...GLOBAL_VALUE_FLAGS].some((flag) => token.startsWith(`${flag}=`))) {
      continue
    }
    kept.push(token)
  }
  return kept
}

const taskCommand = (task: ExtensionCommand) =>
  defineWeeCommand({
    meta: { name: task.name, description: task.description },
    run: async (ctx, _args, rawArgs) => {
      await runPreload({
        ctx,
        args: [
          "--mode",
          "runner",
          "--file",
          task.file,
          "--",
          ...stripGlobalFlags(rawArgs),
        ],
        requireDb: false,
      })
      return undefined
    },
  })

export type { ExtensionCommand }
export { customGeneratorCommand, stripGlobalFlags, taskCommand }
