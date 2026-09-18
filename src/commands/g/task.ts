/**
 * `wee g task <name>`: scaffolds `tools/tasks/<name>.ts`. The CLI runs it
 * as `wee <name>` with the app context preloaded. `reports:nightly` writes
 * `reports-nightly.ts` and both spellings run it.
 */
import { join } from "node:path"
import { defineWeeCommand } from "../../core/command.js"
import { WeeError } from "../../core/errors.js"
import { defineGenerator, runGenerator } from "../../core/generator.js"
import { TASKS_DIR } from "../../lib/custom.js"
import { kebabCase } from "../../lib/inflect.js"
import { taskTemplate } from "../../templates/custom.js"
import { builtInCommands } from "../builtins.js"
import { create } from "./paths.js"

const taskGenerator = defineGenerator({
  name: "task",
  description: "Task under tools/tasks/, run as `wee <name>`",
  args: {
    name: {
      type: "positional",
      description: "Task name, e.g. reports:nightly",
      required: true,
    },
  },
  manifestName: (args) => args.name,
  run: async (ctx, args) => {
    if (args.name in builtInCommands) {
      throw new WeeError(
        "task-reserved",
        `${args.name} is a built-in command. Pick another name.`
      )
    }
    return [
      create(
        ctx,
        join(TASKS_DIR, `${kebabCase(args.name)}.ts`),
        taskTemplate(args.name)
      ),
    ]
  },
})

const task = defineWeeCommand({
  meta: { name: "task", description: taskGenerator.description },
  args: taskGenerator.args,
  run: (ctx, args) => runGenerator({ ctx, generator: taskGenerator, args }),
})

export { task, taskGenerator }
