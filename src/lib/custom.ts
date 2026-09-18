/**
 * Discovery of app-defined extensions: custom generators under
 * `tools/generators/<name>/index.ts` and tasks under `tools/tasks/<name>.ts`.
 * Both are found before citty parses the command line, so the target comes
 * from the global flags in `process.argv`, and no target means none found.
 * The command objects load lazily; discovery only touches the file system.
 */
import { existsSync, readdirSync } from "node:fs"
import { basename, join, relative } from "node:path"
import type { SubCommandsDef } from "citty"
import { parseArgs } from "citty"
import { globalArgs } from "../core/command.js"
import type { Context } from "../core/context.js"
import { buildContext } from "../core/context.js"
import { WeeError } from "../core/errors.js"
import { kebabCase } from "./inflect.js"

const GENERATORS_DIR = join("tools", "generators")
const TASKS_DIR = join("tools", "tasks")

interface Extension {
  /** Command name: the directory name of a generator, the file name of a task. */
  name: string
  /** Absolute path of the module. */
  file: string
}

/**
 * The target for discovery. A missing package.json or an ambiguous
 * monorepo target is an error for a real command, but here it only means
 * there is nothing to discover, so those WeeErrors are swallowed.
 */
const quietContext = async (): Promise<Context | undefined> => {
  const parsed = parseArgs<typeof globalArgs>(process.argv.slice(2), globalArgs)
  try {
    return await buildContext({
      cwd: process.cwd(),
      flags: {
        dryRun: false,
        json: true,
        force: false,
        app: parsed.app,
        pkg: parsed.package,
      },
    })
  } catch (error) {
    if (error instanceof WeeError) {
      return undefined
    }
    throw error
  }
}

const listCustomGenerators = (ctx: Context): Extension[] => {
  const dir = join(ctx.target.path, GENERATORS_DIR)
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(dir, entry.name, "index.ts"))
    )
    .map((entry) => ({
      name: entry.name,
      file: join(dir, entry.name, "index.ts"),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const listTasks = (ctx: Context): Extension[] => {
  const dir = join(ctx.target.path, TASKS_DIR)
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => ({ name: basename(name, ".ts"), file: join(dir, name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** `reports:nightly` and `reports-nightly` both map to `tools/tasks/reports-nightly.ts`. */
const taskFile = (ctx: Context, name: string): string =>
  join(ctx.target.path, TASKS_DIR, `${kebabCase(name)}.ts`)

const describeExtension = (ctx: Context, extension: Extension): string =>
  relative(ctx.target.path, extension.file)

const customGeneratorLoaders = async (): Promise<SubCommandsDef> => {
  const ctx = await quietContext()
  if (ctx === undefined) {
    return {}
  }
  return Object.fromEntries(
    listCustomGenerators(ctx).map((generator) => [
      generator.name,
      () =>
        import("../commands/custom.js").then((m) =>
          m.customGeneratorCommand({
            name: generator.name,
            file: generator.file,
            description: `Custom generator: ${describeExtension(ctx, generator)}`,
          })
        ),
    ])
  )
}

/**
 * Tasks for the top-level command map. `first` is the first argv token:
 * when it names a built-in command nothing is scanned, and when it names
 * a task written with colons the matching file is added under that name.
 */
const taskLoaders = async (
  first: string | undefined,
  builtIns: Record<string, unknown>
): Promise<SubCommandsDef> => {
  if (first === undefined || first in builtIns) {
    return {}
  }
  const ctx = await quietContext()
  if (ctx === undefined) {
    return {}
  }
  const aliased = taskFile(ctx, first)
  const tasks = listTasks(ctx).map((task) =>
    task.file === aliased ? { ...task, name: first } : task
  )
  return Object.fromEntries(
    tasks.map((task) => [
      task.name,
      () =>
        import("../commands/custom.js").then((m) =>
          m.taskCommand({
            name: task.name,
            file: task.file,
            description: `Task: ${describeExtension(ctx, task)}`,
          })
        ),
    ])
  )
}

export type { Extension }
export {
  customGeneratorLoaders,
  GENERATORS_DIR,
  listCustomGenerators,
  listTasks,
  TASKS_DIR,
  taskLoaders,
}
