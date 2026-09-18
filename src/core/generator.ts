/**
 * Generator contract and runner. A generator is pure: it turns its input
 * into a FileChange list. `runGenerator` applies the list, writes the
 * manifest and returns rows for the output layer.
 */
import type { ArgsDef, ParsedArgs } from "citty"
import type { FileChange } from "./changes.js"
import { applyChanges, describeChanges } from "./changes.js"
import type { CommandResult } from "./command.js"
import type { Context } from "./context.js"
import { WeeError } from "./errors.js"
import { manifestPath, writeManifest } from "./manifest.js"

interface GeneratorDef<T extends ArgsDef> {
  /** Name used in `g <name>` and in the manifest id. */
  name: string
  description: string
  args: T
  /** Returns the manifest name for this run, e.g. the model name. */
  manifestName: (args: ParsedArgs<T>) => string
  run: (ctx: Context, args: ParsedArgs<T>) => Promise<FileChange[]>
}

const defineGenerator = <T extends ArgsDef>(
  def: GeneratorDef<T>
): GeneratorDef<T> => def

interface RunGeneratorOptions<T extends ArgsDef> {
  ctx: Context
  generator: GeneratorDef<T>
  args: ParsedArgs<T>
}

interface RecordRunOptions {
  ctx: Context
  /** Generator name, built-in or custom. */
  generator: string
  name: string
  /** Parsed args including `_`; recorded in the manifest. */
  args: Record<string, unknown>
  changes: FileChange[]
}

/** Applies a generator's changes, writes the manifest and returns the rows. */
const recordGeneratorRun = (options: RecordRunOptions): CommandResult => {
  const { ctx, generator, name, args, changes } = options
  if (changes.length === 0) {
    throw new WeeError(
      "nothing-to-do",
      `${generator} ${name} produced no changes`
    )
  }
  const applied = applyChanges({
    root: ctx.target.path,
    changes,
    dryRun: ctx.flags.dryRun,
  })
  // Positionals are kept so later generators (validator, service) can reuse
  // the attribute list a model was created with.
  const { _: positional, ...flags } = args
  const recordedArgs = {
    ...flags,
    ...(Array.isArray(positional) && positional.length > 0
      ? { positional }
      : {}),
  }
  writeManifest({
    targetPath: ctx.target.path,
    generator,
    name,
    cliVersion: ctx.cliVersion,
    args: recordedArgs,
    changes: applied,
    dryRun: ctx.flags.dryRun,
  })
  const manifest = manifestPath(ctx.target.path, generator, name).replace(
    `${ctx.target.path}/`,
    ""
  )
  return {
    title: ctx.flags.dryRun
      ? `dry-run: ${generator} ${name}`
      : `${generator} ${name}`,
    data: [...describeChanges(changes), { action: "manifest", path: manifest }],
  }
}

const runGenerator = async <T extends ArgsDef>(
  options: RunGeneratorOptions<T>
): Promise<CommandResult> => {
  const { ctx, generator, args } = options
  const name = generator.manifestName(args)
  const changes = await generator.run(ctx, args)
  return recordGeneratorRun({
    ctx,
    generator: generator.name,
    name,
    args: args as ParsedArgs,
    changes,
  })
}

export type { GeneratorDef }
export { defineGenerator, recordGeneratorRun, runGenerator }
